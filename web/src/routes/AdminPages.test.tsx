import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { AdminGenresPage } from "./AdminPages";
import { App } from "@/App";
import { API, apiError, list, makeGenre, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import type { Genre } from "@/lib/types";

const admin = makeUser({ role: "admin" });

/** Replaces the default empty catalog of genres for one spec. */
function serveGenres(...genres: Genre[]) {
  server.use(http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list(genres))));
}

describe("admin console routing", () => {
  // The guard sits in App.tsx rather than in the pages, so it is the routes
  // that have to be exercised — and every one of them, which is why this walks
  // the list rather than naming the screen the change happened to add. A route
  // left unwrapped renders for everybody, and the only thing that would say so
  // is the server refusing the writes made from it.
  it.each([
    ["/admin/genres", "Genres"],
    ["/admin/users", "Users"],
  ])("sends a contributor away from %s", async (route, heading) => {
    renderWithProviders(<App />, { user: makeUser({ role: "contributor" }), route });

    // Landed on the catalog, which is the redirect's target.
    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: heading })).not.toBeInTheDocument();
  });

  // The console is a section, so `/admin` itself is not a screen: the nav entry
  // points there to stay lit across both, and the index redirect is what gives
  // it something to open. Without it the entry leads to an empty layout.
  it("opens the console on its first screen", async () => {
    // The only spec that renders the users screen, so it is the only one that
    // needs its rows: there is no default handler for the admin routes.
    server.use(http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list([]))));

    renderWithProviders(<App />, { user: admin, route: "/admin" });

    expect(await screen.findByRole("heading", { level: 1, name: "Users" })).toBeInTheDocument();
  });

  // While the Prelude session is being restored the app holds the snapshot of
  // the last session this browser had, or nothing — which is indistinguishable
  // from a guest. Deciding then would make a reload of an admin screen bounce
  // its own admin to the catalog, or open the console on a role that snapshot
  // merely remembers.
  it("waits for the session before deciding", async () => {
    renderWithProviders(<App />, { user: null, auth: { loading: true }, route: "/admin/genres" });

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  // The navigation carries one entry for the whole console, so it points at
  // `/admin` and relies on NavLink's prefix match. Pointed at a screen instead,
  // it goes dark the moment an admin opens the other one.
  it("keeps the console lit on a screen the entry does not name", async () => {
    renderWithProviders(<App />, { user: admin, route: "/admin/genres" });

    // Rendered twice: the sidebar and the phone's tab bar.
    const entries = await screen.findAllByRole("link", { name: "Admin" });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toHaveAttribute("aria-current", "page");
    }
  });
});

describe("AdminGenresPage", () => {
  it("lists each genre with what it is on", async () => {
    serveGenres(makeGenre({ name: "Ρεμπέτικο", slug: "rempetiko", song_count: 12 }));

    renderWithProviders(<AdminGenresPage />, { user: admin });

    expect(await screen.findByText("Ρεμπέτικο")).toBeInTheDocument();
    expect(screen.getByText(/12 songs/)).toBeInTheDocument();
  });

  // A failed fetch has no rows, so the empty state would stand in for it — and
  // the advice it gives is to add the genres that already exist, each of which
  // is then refused as a duplicate slug for reasons the screen cannot explain.
  it("says a failed fetch failed rather than showing an empty catalog", async () => {
    server.use(
      http.get(`${API}/api/v1/genres`, () =>
        apiError(500, "internal_error", "Something went wrong."),
      ),
    );

    renderWithProviders(<AdminGenresPage />, { user: admin });

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.queryByText("No genres yet")).not.toBeInTheDocument();
  });

  // The reason this screen exists: the song editor offers only the genres that
  // already exist, so without a way to add one the catalog is stuck with the
  // set the seed and the import happened to create.
  it("adds a genre and shows it without a reload", async () => {
    const posted: string[] = [];
    let genres: Genre[] = [];
    server.use(
      http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list(genres))),
      http.post(`${API}/api/v1/genres`, async ({ request }) => {
        const body = (await request.json()) as { name: string };
        posted.push(body.name);
        const created = makeGenre({ id: "genre-new", name: body.name, slug: "entechno" });
        genres = [created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    renderWithProviders(<AdminGenresPage />, { user: admin });

    await userEvent.click(await screen.findByRole("button", { name: /New genre/ }));
    await userEvent.type(screen.getByLabelText("Name"), "  Έντεχνο  ");
    await userEvent.click(screen.getByRole("button", { name: "Add genre" }));

    // Trimmed on the way out, so a stray space cannot produce a second genre
    // that reads as the one already there.
    await waitFor(() => expect(posted).toEqual(["Έντεχνο"]));
    expect(await screen.findByText("Έντεχνο")).toBeInTheDocument();
  });

  // A name the catalog already has is an ordinary outcome, and the server's own
  // sentence says so — the sheet stays up with the name still in it, rather
  // than closing on a genre that was never created.
  it("reports a refusal without closing the sheet", async () => {
    server.use(
      http.post(`${API}/api/v1/genres`, () =>
        apiError(409, "conflict", "That genre already exists."),
      ),
    );

    renderWithProviders(<AdminGenresPage />, { user: admin });

    await userEvent.click(await screen.findByRole("button", { name: /New genre/ }));
    await userEvent.type(screen.getByLabelText("Name"), "Ρεμπέτικο");
    await userEvent.click(screen.getByRole("button", { name: "Add genre" }));

    expect(await screen.findByText("That genre already exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Ρεμπέτικο");
  });

  it("renames a genre from the name it has", async () => {
    serveGenres(makeGenre({ id: "genre-9", name: "Ροκ", song_count: 3 }));
    let sent: { id: string; name: string } | null = null;
    server.use(
      http.patch(`${API}/api/v1/genres/:id`, async ({ params, request }) => {
        const body = (await request.json()) as { name: string };
        sent = { id: String(params.id), name: body.name };
        return HttpResponse.json(makeGenre({ id: "genre-9", name: body.name }));
      }),
    );

    renderWithProviders(<AdminGenresPage />, { user: admin });

    await userEvent.click(await screen.findByRole("button", { name: "Rename Ροκ" }));
    // Prefilled, which is what makes this a correction rather than a retype.
    const field = screen.getByLabelText("Name");
    expect(field).toHaveValue("Ροκ");

    await userEvent.clear(field);
    await userEvent.type(field, "Rock");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(sent).toEqual({ id: "genre-9", name: "Rock" }));
  });

  // A rename changes a name that rides inside other payloads: a song, a song
  // row, and — two hops down, in `songs[].genres` — a list. Nothing on this
  // screen reads those caches, so dropping one of the keys leaves every spec
  // green while a renamed genre keeps its old label wherever a reader had
  // already been.
  //
  // Asserted on the keys rather than on the cache itself: the test client sets
  // `gcTime: 0`, so an entry seeded here with nothing observing it is collected
  // before the rename lands and every state reads back undefined.
  it("unsettles the caches a genre name rides inside", async () => {
    serveGenres(makeGenre({ id: "genre-9", name: "Ροκ" }));
    server.use(
      http.patch(`${API}/api/v1/genres/:id`, () =>
        HttpResponse.json(makeGenre({ id: "genre-9", name: "Rock" })),
      ),
    );

    const { queryClient } = renderWithProviders(<AdminGenresPage />, { user: admin });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await userEvent.click(await screen.findByRole("button", { name: "Rename Ροκ" }));
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Rock");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      const unsettled = invalidate.mock.calls.map((call) => String(call[0]?.queryKey));
      for (const key of [["genres"], ["songs"], ["song"], ["list"]]) {
        expect(unsettled).toContain(String(key));
      }
    });
  });

  // The delete sheet is the one place a refusal has nowhere else to go: it is a
  // confirmation rather than a form, so a message that closed with it would
  // leave an admin believing a genre they can still see was deleted.
  it("keeps the delete confirmation open on a refusal", async () => {
    serveGenres(makeGenre({ id: "genre-9", name: "Ροκ", song_count: 2 }));
    server.use(
      http.delete(`${API}/api/v1/genres/:id`, () =>
        apiError(409, "conflict", "Genre is still referenced by other records."),
      ),
    );

    renderWithProviders(<AdminGenresPage />, { user: admin });

    await userEvent.click(await screen.findByRole("button", { name: "Delete Ροκ" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText("Genre is still referenced by other records."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  // Deleting a genre takes it off every song that carries it — `song_genres`
  // cascades — and the count is the only place that is ever said. Without it
  // the confirmation reads as though one label were being tidied away.
  it("says how many songs lose the label before deleting one", async () => {
    serveGenres(makeGenre({ id: "genre-9", name: "Ροκ", song_count: 12 }));
    let deleted = "";
    server.use(
      http.delete(`${API}/api/v1/genres/:id`, ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderWithProviders(<AdminGenresPage />, { user: admin });

    await userEvent.click(await screen.findByRole("button", { name: "Delete Ροκ" }));
    expect(screen.getByText(/12 songs will lose this label/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted).toBe("genre-9"));
  });
});
