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
  // The guard is in App.tsx, so every console route is walked: one left
  // unwrapped renders for everybody, silently.
  it.each([
    ["/admin/genres", "Genres"],
    ["/admin/users", "Users"],
  ])("sends a contributor away from %s", async (route, heading) => {
    renderWithProviders(<App />, { user: makeUser({ role: "contributor" }), route });

    // Landed on the catalog.
    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: heading })).not.toBeInTheDocument();
  });

  // `/admin` is not a screen; without the index redirect it is an empty layout.
  it("opens the console on its first screen", async () => {
    // No default handler covers the admin routes.
    server.use(http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list([]))));

    renderWithProviders(<App />, { user: admin, route: "/admin" });

    expect(await screen.findByRole("heading", { level: 1, name: "Users" })).toBeInTheDocument();
  });

  // Until the session restores, `user` is a snapshot or null; deciding then
  // bounces an admin on reload or trusts a remembered role.
  it("waits for the session before deciding", async () => {
    renderWithProviders(<App />, { user: null, auth: { loading: true }, route: "/admin/genres" });

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  // The nav entry points at `/admin`; pointed at a screen it goes dark on the other.
  it("keeps the console lit on a screen the entry does not name", async () => {
    renderWithProviders(<App />, { user: admin, route: "/admin/genres" });

    // Rendered twice: the sidebar and the phone's navigation drawer.
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

  // An empty state here would advise re-adding genres that already exist.
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

    // Trimmed, so a stray space cannot make a lookalike second genre.
    await waitFor(() => expect(posted).toEqual(["Έντεχνο"]));
    expect(await screen.findByText("Έντεχνο")).toBeInTheDocument();
  });

  // The sheet stays up with the name still in it and the server's reason.
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
    // Prefilled with the current name.
    const field = screen.getByLabelText("Name");
    expect(field).toHaveValue("Ροκ");

    await userEvent.clear(field);
    await userEvent.type(field, "Rock");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(sent).toEqual({ id: "genre-9", name: "Rock" }));
  });

  // A genre name rides inside song and list payloads; see CLAUDE.md, "Genres".
  // Asserted on the keys: with `gcTime: 0` an unobserved seeded cache is collected.
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

  // Closing on a refusal would read as a successful delete.
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

  // `song_genres` cascades; the count is the only place that is said.
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
