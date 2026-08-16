import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ListDetailPage } from "./ListsPages";
import { API, makeList, makeSong, makeUser } from "@/test/handlers";
import { stubRowRects } from "@/test/rects";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Serves each list by id, so a copy that navigates to its own page finds
 * something there rather than a 404 the spec would have to work around.
 */
function serveLists(...lists: ReturnType<typeof makeList>[]) {
  server.use(
    http.get(`${API}/api/v1/lists/:id`, ({ params }) => {
      const found = lists.find((l) => l.id === params.id);
      return found
        ? HttpResponse.json(found)
        : HttpResponse.json({ error: { code: "not_found", message: "List was not found." } }, { status: 404 });
    }),
  );
}

function renderDetail(
  route: string,
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  return renderWithProviders(
    <Routes>
      <Route path="/lists/:id" element={<ListDetailPage />} />
      <Route path="/login" element={<h1>Sign in</h1>} />
    </Routes>,
    { route, ...options },
  );
}

describe("ListDetailPage", () => {
  // A request that goes out before the Prelude session is restored carries no
  // token, so a private list answers 404 — and its owner is told, on every
  // reload, that their own list does not exist. It cannot self-correct either:
  // apiFetch retries a 401 with a fresh token, and this is deliberately not one.
  it("does not ask for a list until the session is known", async () => {
    let requested = 0;
    server.use(
      http.get(`${API}/api/v1/lists/:id`, () => {
        requested += 1;
        return HttpResponse.json(makeList({ id: "list-1", owner_id: "user-1" }));
      }),
    );

    renderDetail("/lists/list-1", { user: null, auth: { loading: true } });

    // Long enough for a query that fires on mount to have fired.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(requested).toBe(0);
    // And the wait must read as a wait: a disabled query is not "loading" to
    // React Query, so the page has to hold the skeleton itself rather than fall
    // through to reporting a list it never asked for as unavailable.
    expect(screen.queryByText(/not available/i)).not.toBeInTheDocument();
  });

  it("asks once the session has settled", async () => {
    serveLists(makeList({ id: "list-1", owner_id: "user-1", name: "Ρεμπέτικα" }));

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    expect(await screen.findByRole("heading", { name: "Ρεμπέτικα" })).toBeInTheDocument();
  });
});

describe("ListDetailPage sharing", () => {
  it("offers the copy to a reader who does not own the list", async () => {
    const user = userEvent.setup();
    const source = makeList({ id: "list-1", owner_id: "someone-else", name: "Ρεμπέτικα" });
    const copy = makeList({ id: "list-2", owner_id: "user-1", name: "Ρεμπέτικα", is_public: false });
    serveLists(source, copy);
    server.use(http.post(`${API}/api/v1/lists/:id/copy`, () => HttpResponse.json(copy, { status: 201 })));

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /save to my lists/i }));

    // The copy is its own list, so the page moves to it — that is what makes it
    // editable rather than merely readable.
    await waitFor(() => expect(screen.getByRole("button", { name: /delete list/i })).toBeInTheDocument());
  });

  // Names are unique per owner, so copying the same list twice is a routine
  // outcome the user can resolve, not an error to report and stop at.
  it("asks for a new name when the copy collides with an existing list", async () => {
    const user = userEvent.setup();
    const source = makeList({ id: "list-1", owner_id: "someone-else", name: "Ρεμπέτικα" });
    const copy = makeList({ id: "list-2", owner_id: "user-1", name: "Ρεμπέτικα 2", is_public: false });
    serveLists(source, copy);

    let sentName: unknown;
    server.use(
      http.post(`${API}/api/v1/lists/:id/copy`, async ({ request }) => {
        const body = (await request.json()) as { name?: string };
        sentName = body.name;
        if (body.name === undefined) {
          return HttpResponse.json(
            { error: { code: "conflict", message: "You already have a list with that name." } },
            { status: 409 },
          );
        }
        return HttpResponse.json(copy, { status: 201 });
      }),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /save to my lists/i }));

    const dialog = await screen.findByRole("dialog", { name: /name your copy/i });
    expect(await screen.findByText(/already have a list with that name/i)).toBeInTheDocument();

    const field = screen.getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "Ρεμπέτικα 2");
    await user.click(within(dialog).getByRole("button", { name: /save to my lists/i }));

    await waitFor(() => expect(sentName).toBe("Ρεμπέτικα 2"));
  });

  it("sends a signed-out reader to sign in, remembering the list", async () => {
    const user = userEvent.setup();
    serveLists(makeList({ id: "list-1", owner_id: "someone-else" }));

    renderDetail("/lists/list-1");

    await user.click(await screen.findByRole("button", { name: /save to my lists/i }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  // The order is the list, so an owner must be able to change it — and a reader
  // must not be handed the affordance to try.
  it("lets the owner reorder their list and saves the new order", async () => {
    const user = userEvent.setup();
    const songs = [
      makeSong({ id: "song-1", title: "First" }),
      makeSong({ id: "song-2", title: "Second" }),
    ];
    const owned = makeList({ id: "list-1", owner_id: "user-1", item_count: 2, songs });
    serveLists(owned);

    let posted: string[] | undefined;
    server.use(
      http.post(`${API}/api/v1/lists/:id/reorder`, async ({ request }) => {
        posted = ((await request.json()) as { song_ids: string[] }).song_ids;
        return HttpResponse.json({ ...owned, songs: [songs[1], songs[0]] });
      }),
    );

    const { container } = renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    // The drag machinery is a lazy chunk, so the handle appears a tick late.
    const handle = await screen.findByRole("button", { name: "Reorder First" });
    stubRowRects(container);

    handle.focus();
    await user.keyboard("{ }");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");

    await waitFor(() => expect(posted).toEqual(["song-2", "song-1"]));
  });

  // Two drags in quick succession race: the first response can land after the
  // second, and reinstating it would undo a move the user already made.
  it("keeps the newest order when an earlier save answers last", async () => {
    const user = userEvent.setup();
    const songs = [
      makeSong({ id: "song-1", title: "First" }),
      makeSong({ id: "song-2", title: "Second" }),
      makeSong({ id: "song-3", title: "Third" }),
    ];
    const owned = makeList({ id: "list-1", owner_id: "user-1", item_count: 3, songs });
    serveLists(owned);

    let saves = 0;
    server.use(
      http.post(`${API}/api/v1/lists/:id/reorder`, async () => {
        saves += 1;
        // The first save is the slow one, so its stale answer arrives last.
        await delay(saves === 1 ? 120 : 0);
        return HttpResponse.json({ ...owned, songs });
      }),
    );

    const { container } = renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });
    await screen.findByRole("button", { name: "Reorder First" });

    const drag = async (title: string) => {
      // Re-measured before each drag: a real browser reads live layout, while
      // these rects are pinned to nodes that the previous drag moved.
      stubRowRects(container);
      screen.getByRole("button", { name: `Reorder ${title}` }).focus();
      await user.keyboard("{ }");
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ }");
    };

    await drag("First"); // → Second, First, Third
    await drag("First"); // → Second, Third, First

    await waitFor(() => expect(saves).toBe(2));
    // The slow first response, carrying the original order, must not resurface.
    await waitFor(() =>
      expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
        expect.stringContaining("Second"),
        expect.stringContaining("Third"),
        expect.stringContaining("First"),
      ]),
    );
  });

  it("does not offer reordering to someone reading a shared list", async () => {
    serveLists(
      makeList({
        id: "list-1",
        owner_id: "someone-else",
        item_count: 2,
        songs: [makeSong({ id: "song-1", title: "First" }), makeSong({ id: "song-2" })],
      }),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    expect(await screen.findByText("First")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reorder/ })).not.toBeInTheDocument();
  });

  it("shows the owner a link to share, and no copy of their own list", async () => {
    const user = userEvent.setup();
    serveLists(makeList({ id: "list-1", owner_id: "user-1", is_public: true }));

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /^share$/i }));

    expect(screen.getByLabelText(/link to this list/i)).toHaveValue(
      `${window.location.origin}/lists/list-1`,
    );
    expect(screen.queryByRole("button", { name: /save to my lists/i })).not.toBeInTheDocument();
  });

  // Publishing is what makes a link work at all, so it is asked for rather than
  // applied silently behind the share button.
  it("asks the owner to publish a private list before handing out a link", async () => {
    const user = userEvent.setup();
    serveLists(makeList({ id: "list-1", owner_id: "user-1", is_public: false }));

    let published: unknown;
    server.use(
      http.patch(`${API}/api/v1/lists/:id`, async ({ request }) => {
        const body = (await request.json()) as { is_public?: boolean };
        published = body.is_public;
        return HttpResponse.json(makeList({ id: "list-1", owner_id: "user-1", is_public: true }));
      }),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /^share$/i }));
    expect(screen.queryByLabelText(/link to this list/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /publish and get a link/i }));

    await waitFor(() => expect(published).toBe(true));
  });
});
