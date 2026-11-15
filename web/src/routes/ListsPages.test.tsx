import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { ListDetailPage, ListsPage } from "./ListsPages";
import { keys } from "@/api/hooks";
import { API, apiError, list, listById, makeList, makeSong, makeUser } from "@/test/handlers";
import { stubRowRects } from "@/test/rects";
import { renderWithProviders } from "@/test/render";
import { TestRoutes } from "@/test/routes";
import { server } from "@/test/server";

/**
 * Serves each list by id, so a copy navigating to its own page finds it.
 */
function serveLists(...lists: ReturnType<typeof makeList>[]) {
  server.use(listById(...lists));
}

function renderDetail(route: string, options: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(
    <TestRoutes
      routes={{
        "/lists/:id": <ListDetailPage />,
        "/login": <h1>Sign in</h1>,
        // Where a deleted list leaves its owner.
        "/lists": <h1>Your lists</h1>,
      }}
    />,
    { route, ...options },
  );
}

describe("ListsPage", () => {
  it("lists the reader's lists, each marked public or private, with its song count", async () => {
    server.use(
      http.get(`${API}/api/v1/lists`, () =>
        HttpResponse.json(
          list([
            makeList({ id: "list-1", name: "Ρεμπέτικα", is_public: true, item_count: 3 }),
            makeList({ id: "list-2", name: "Έντεχνα", is_public: false, item_count: 1 }),
          ]),
        ),
      ),
    );

    renderWithProviders(<ListsPage />, { user: makeUser() });

    const shared = await screen.findByRole("link", { name: /Ρεμπέτικα/ });
    expect(shared).toHaveAttribute("href", "/lists/list-1");
    expect(within(shared).getByText("Public")).toBeInTheDocument();
    expect(within(shared).getByText("3 songs")).toBeInTheDocument();

    const own = screen.getByRole("link", { name: /Έντεχνα/ });
    expect(within(own).getByText("Private")).toBeInTheDocument();
    expect(within(own).getByText("1 song")).toBeInTheDocument();
  });

  it("says there are no lists yet rather than showing nothing", async () => {
    renderWithProviders(<ListsPage />, { user: makeUser() });

    expect(await screen.findByText("No lists yet")).toBeInTheDocument();
  });

  it("says the lists could not be loaded rather than showing none", async () => {
    server.use(
      http.get(`${API}/api/v1/lists`, () => apiError(500, "internal", "Something went wrong.")),
    );

    renderWithProviders(<ListsPage />, { user: makeUser() });

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.queryByText("No lists yet")).not.toBeInTheDocument();
  });

  // As on the song page: a refetch runs on every return to the tab, and one
  // that fails must not report a request the reader never made.
  it("keeps the lists a reader already has when a refetch fails", async () => {
    server.use(
      http.get(`${API}/api/v1/lists`, () =>
        HttpResponse.json(list([makeList({ id: "list-1", name: "Ρεμπέτικα" })])),
      ),
    );
    const { queryClient } = renderWithProviders(<ListsPage />, { user: makeUser() });
    await screen.findByRole("link", { name: /Ρεμπέτικα/ });

    server.use(
      http.get(`${API}/api/v1/lists`, () => apiError(500, "internal", "Something went wrong.")),
    );
    await act(() => queryClient.refetchQueries({ queryKey: keys.lists() }));
    // The refetch resolves before react-query tells the page; pressing a
    // control renders it first, or the assertion below cannot fail.
    await userEvent.click(screen.getByRole("button", { name: "New list" }));

    expect(screen.getByRole("link", { name: /Ρεμπέτικα/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("creates a list under the trimmed name and shows it once created", async () => {
    const user = userEvent.setup();
    const created: ReturnType<typeof makeList>[] = [];
    let sentName: unknown;
    server.use(
      http.get(`${API}/api/v1/lists`, () => HttpResponse.json(list(created))),
      http.post(`${API}/api/v1/lists`, async ({ request }) => {
        sentName = ((await request.json()) as { name: string }).name;
        const made = makeList({ id: "list-9", name: String(sentName) });
        created.push(made);
        return HttpResponse.json(made, { status: 201 });
      }),
    );

    renderWithProviders(<ListsPage />, { user: makeUser() });

    await user.click(await screen.findByRole("button", { name: /new list/i }));
    await user.type(screen.getByLabelText("Name"), "  Καντάδες  ");
    await user.click(screen.getByRole("button", { name: "Create list" }));

    await waitFor(() => expect(sentName).toBe("Καντάδες"));
    // The sheet closes and the list, refetched, is on the page.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("link", { name: /Καντάδες/ })).toBeInTheDocument();
  });

  // Names are unique per owner; the refusal must not close the sheet on the
  // name the reader typed.
  it("keeps the sheet open and says why when a list cannot be created", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/api/v1/lists`, () =>
        apiError(409, "conflict", "You already have a list with that name."),
      ),
    );

    renderWithProviders(<ListsPage />, { user: makeUser() });

    await user.click(await screen.findByRole("button", { name: /new list/i }));
    await user.type(screen.getByLabelText("Name"), "Ρεμπέτικα");
    await user.click(screen.getByRole("button", { name: "Create list" }));

    const dialog = screen.getByRole("dialog", { name: "New list" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You already have a list with that name.",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Ρεμπέτικα");
  });
});

describe("ListDetailPage", () => {
  // A stranger asking for a private list gets the same 404 as a deleted one.
  it("says a list it cannot read is not available, with a way back", async () => {
    serveLists();

    renderDetail("/lists/missing", { user: makeUser({ id: "user-1" }) });

    expect(await screen.findByRole("alert")).toHaveTextContent("This list is not available.");
    expect(screen.getByRole("link", { name: "Back to lists" })).toHaveAttribute("href", "/lists");
  });

  // A tokenless request makes a private list 404 to its owner, and apiFetch
  // retries only 401s. See CLAUDE.md, "Frontend".
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
    // A disabled query is not `isLoading`; the page must hold its own skeleton.
    expect(screen.queryByText(/not available/i)).not.toBeInTheDocument();
  });

  // The server's read of a public list renders before the session is known, so
  // `!user` there would send a signed-in reader to sign in.
  it("holds the copy button until the session is known", async () => {
    const { queryClient } = renderDetail("/lists/list-1", {
      user: null,
      auth: { loading: true },
    });
    act(() => {
      queryClient.setQueryData(
        keys.list("list-1"),
        makeList({ id: "list-1", owner_id: "someone-else", name: "Ρεμπέτικα" }),
      );
    });

    expect(await screen.findByRole("heading", { name: "Ρεμπέτικα" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save to my lists/i })).toBeDisabled();
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
    const copy = makeList({
      id: "list-2",
      owner_id: "user-1",
      name: "Ρεμπέτικα",
      is_public: false,
    });
    serveLists(source, copy);
    server.use(
      http.post(`${API}/api/v1/lists/:id/copy`, () => HttpResponse.json(copy, { status: 201 })),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /save to my lists/i }));

    // The page moves to the copy, which the reader can edit.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /delete list/i })).toBeInTheDocument(),
    );
  });

  // Names are unique per owner, so a second copy asks for a new name.
  it("asks for a new name when the copy collides with an existing list", async () => {
    const user = userEvent.setup();
    const source = makeList({ id: "list-1", owner_id: "someone-else", name: "Ρεμπέτικα" });
    const copy = makeList({
      id: "list-2",
      owner_id: "user-1",
      name: "Ρεμπέτικα 2",
      is_public: false,
    });
    serveLists(source, copy);

    let sentName: unknown;
    server.use(
      http.post(`${API}/api/v1/lists/:id/copy`, async ({ request }) => {
        const body = (await request.json()) as { name?: string };
        sentName = body.name;
        if (body.name === undefined) {
          return apiError(409, "conflict", "You already have a list with that name.");
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

  // A stale first response landing after the second must not undo the move.
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

  it("does not offer reordering or removal to someone reading a shared list", async () => {
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
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
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

  // Publishing is asked for, never applied silently behind Share.
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

  it("copies the share link and says it did", async () => {
    // `setup` installs user-event's clipboard on `navigator`.
    const user = userEvent.setup();
    serveLists(makeList({ id: "list-1", owner_id: "user-1", is_public: true }));

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /^share$/i }));
    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `${window.location.origin}/lists/list-1`,
    );
  });

  // Clipboard access can be refused; the link is still on screen to copy by hand.
  it("asks for a manual copy when the clipboard refuses the link", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new DOMException("Denied", "NotAllowedError"),
    );
    serveLists(makeList({ id: "list-1", owner_id: "user-1", is_public: true }));

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /^share$/i }));
    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/select the link above/i);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("lets the owner take a public list private again", async () => {
    const user = userEvent.setup();
    serveLists(makeList({ id: "list-1", owner_id: "user-1", is_public: true }));

    let sent: unknown;
    server.use(
      http.patch(`${API}/api/v1/lists/:id`, async ({ request }) => {
        sent = ((await request.json()) as { is_public?: boolean }).is_public;
        return HttpResponse.json(makeList({ id: "list-1", owner_id: "user-1", is_public: false }));
      }),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /make private/i }));

    await waitFor(() => expect(sent).toBe(false));
  });

  // Only a name conflict has a remedy the reader can supply.
  it("reports any other copy failure without asking for a new name", async () => {
    const user = userEvent.setup();
    serveLists(makeList({ id: "list-1", owner_id: "someone-else" }));
    server.use(
      http.post(`${API}/api/v1/lists/:id/copy`, () =>
        apiError(500, "internal", "Something went wrong."),
      ),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /save to my lists/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.queryByRole("dialog", { name: /name your copy/i })).not.toBeInTheDocument();
  });

  // The conflict is about a name the reader has stopped choosing; left behind,
  // it would sit under the button describing nothing they are doing.
  it("drops the name conflict when the rename is abandoned", async () => {
    const user = userEvent.setup();
    serveLists(makeList({ id: "list-1", owner_id: "someone-else" }));
    server.use(
      http.post(`${API}/api/v1/lists/:id/copy`, () =>
        apiError(409, "conflict", "You already have a list with that name."),
      ),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /save to my lists/i }));
    const dialog = await screen.findByRole("dialog", { name: /name your copy/i });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText(/already have a list with that name/i)).not.toBeInTheDocument();
  });
});

describe("ListDetailPage default list", () => {
  // The server refuses to delete it; the page must not offer what will fail.
  it("does not offer to delete the owner's default list", async () => {
    serveLists(makeList({ id: "list-1", owner_id: "user-1", is_default: true }));

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    expect(await screen.findByRole("button", { name: /^share$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete list/i })).not.toBeInTheDocument();
  });
});

describe("ListDetailPage reorder failure", () => {
  it("says so when the new order cannot be saved", async () => {
    const user = userEvent.setup();
    const songs = [
      makeSong({ id: "song-1", title: "First" }),
      makeSong({ id: "song-2", title: "Second" }),
    ];
    serveLists(makeList({ id: "list-1", owner_id: "user-1", item_count: 2, songs }));
    server.use(
      http.post(`${API}/api/v1/lists/:id/reorder`, () =>
        apiError(500, "internal", "Something went wrong."),
      ),
    );

    const { container } = renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    const handle = await screen.findByRole("button", { name: "Reorder First" });
    stubRowRects(container);
    handle.focus();
    await user.keyboard("{ }");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ }");

    expect(await screen.findByText("The new order could not be saved.")).toBeInTheDocument();
  });
});

/**
 * Serves one list that a removal actually changes: the row leaves only when the
 * refetch after the DELETE omits it, so a fixed fixture would never let it go.
 */
function serveRemovableList(list: ReturnType<typeof makeList>) {
  serveLists(list);
  const deleted: string[] = [];

  server.use(
    http.delete(`${API}/api/v1/lists/:id/songs/:songID`, ({ params }) => {
      const songId = String(params.songID);
      deleted.push(songId);
      list.songs = (list.songs ?? []).filter((song) => song.id !== songId);
      list.item_count = list.songs.length;
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return deleted;
}

describe("ListDetailPage removal", () => {
  it("lets the owner take a song out of their list", async () => {
    const user = userEvent.setup();
    const deleted = serveRemovableList(
      makeList({
        id: "list-1",
        owner_id: "user-1",
        item_count: 2,
        songs: [
          makeSong({ id: "song-1", title: "First" }),
          makeSong({ id: "song-2", title: "Second" }),
        ],
      }),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: "Remove First from this list" }));

    // Exactly one DELETE: the button disables itself while its own removal is
    // in flight, and a second would 404 on a song the list no longer holds.
    await waitFor(() => expect(deleted).toEqual(["song-1"]));
    await waitFor(() => expect(screen.queryByText("First")).not.toBeInTheDocument());
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  // A list of one renders without drag machinery and must still offer removal.
  it("offers removal on a list of one, where there is nothing to reorder", async () => {
    const user = userEvent.setup();
    serveRemovableList(
      makeList({
        id: "list-1",
        owner_id: "user-1",
        item_count: 1,
        songs: [makeSong({ id: "song-1", title: "Only" })],
      }),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    const remove = await screen.findByRole("button", { name: "Remove Only from this list" });
    expect(screen.queryByRole("button", { name: /^Reorder/ })).not.toBeInTheDocument();

    await user.click(remove);

    expect(await screen.findByText(/this list is empty/i)).toBeInTheDocument();
  });

  // A failure leaves the song in place and must say so.
  it("keeps the song and reports the failure when the removal is refused", async () => {
    const user = userEvent.setup();
    serveLists(
      makeList({
        id: "list-1",
        owner_id: "user-1",
        item_count: 1,
        songs: [makeSong({ id: "song-1", title: "First" })],
      }),
    );
    server.use(
      http.delete(`${API}/api/v1/lists/:id/songs/:songID`, () =>
        apiError(500, "internal", "Something went wrong."),
      ),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: "Remove First from this list" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
    expect(screen.getByText("First")).toBeInTheDocument();
  });
});

// Exercises the shared `ConfirmSheet`, as does SongDetailPage's delete spec.
describe("ListDetailPage deletion", () => {
  it("asks before deleting a list, and deletes the one it named", async () => {
    serveLists(makeList({ id: "list-1", owner_id: "user-1", name: "Ρεμπέτικα" }));
    let deleted = "";
    server.use(
      http.delete(`${API}/api/v1/lists/:id`, ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await userEvent.click(await screen.findByRole("button", { name: /Delete list/ }));
    expect(screen.getByText(/The songs themselves are not affected/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted).toBe("list-1"));
    expect(await screen.findByRole("heading", { name: "Your lists" })).toBeInTheDocument();
  });

  it("does nothing to a list the confirmation was dismissed for", async () => {
    serveLists(makeList({ id: "list-1", owner_id: "user-1", name: "Ρεμπέτικα" }));
    let requested = false;
    server.use(
      http.delete(`${API}/api/v1/lists/:id`, () => {
        requested = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetail("/lists/list-1", { user: makeUser({ id: "user-1" }) });

    await userEvent.click(await screen.findByRole("button", { name: /Delete list/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/The songs themselves are not affected/)).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });
});
