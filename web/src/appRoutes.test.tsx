import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { User } from "@/lib/types";
import { API, list, listById, makeList, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import { TestApp } from "@/test/app";
import { CurrentAddress } from "@/test/routes";

/*
 * Every screen inside the shell offers the hamburger. `SearchHeader` and the
 * `(menu)` layout supply it independently, so only the app directory itself,
 * composed by position (`test/app.tsx`), can check both; a miss leaves a phone
 * on a screen it cannot navigate off.
 */
describe("Reaching the navigation from every screen", () => {
  const admin = makeUser({ role: "admin" });

  /** Each address a reader can be at inside the shell, and who is at it. */
  const SCREENS: { route: string; user?: User }[] = [
    { route: "/" },
    { route: "/songs/song-1" },
    { route: "/songs/new", user: admin },
    { route: "/songs/song-1/edit", user: admin },
    { route: "/lists", user: admin },
    { route: "/lists/list-1" },
    { route: "/profile" },
    { route: "/admin", user: admin },
    { route: "/admin/genres", user: admin },
    // The root not-found sits outside the route groups and mounts their
    // layouts itself, so it needs the same way off it.
    { route: "/nowhere-at-all" },
  ];

  it.each(SCREENS)("offers the drawer at $route", async ({ route, user = null }) => {
    // Not covered by the default handlers; they only have to answer.
    server.use(
      listById(makeList()),
      http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list<User>([]))),
    );

    renderWithProviders(<TestApp />, { route, user });

    // The reader mounts the list and the song together, and each carries the
    // button. jsdom has no breakpoints, so the one a phone would hide is here
    // too; either one is the way to the drawer.
    expect(await screen.findAllByRole("button", { name: "Open menu" })).not.toHaveLength(0);
  });

  // The credential screens have no navigation by design.
  it.each(["/login", "/register", "/forgot-password"])("offers none at %s", async (route) => {
    renderWithProviders(<TestApp />, { route });

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
  });

  it("puts the catalog beside the lyrics, and an empty pane where no song is open", async () => {
    const { unmount } = renderWithProviders(<TestApp />, { route: "/" });

    expect(await screen.findByRole("searchbox", { name: /search songs/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select a song" })).toBeInTheDocument();
    unmount();

    renderWithProviders(<TestApp />, { route: "/songs/thalassa-platia" });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Θάλασσα Πλατιά" }),
    ).toBeInTheDocument();
    // The list is still there: its search box, with the open song marked in it.
    expect(screen.getByRole("searchbox", { name: /search songs/i })).toBeInTheDocument();
    // jsdom has no container width; the class is what draws the line once the
    // panes sit side by side. The region itself does not scroll: the scrollbar
    // belongs to the songs under the search.
    const songs = screen.getByRole("region", { name: "Songs" });
    expect(songs).toHaveClass("@3xl/app:border-r");
    expect(songs).not.toHaveClass("@3xl/app:overflow-y-auto");
    expect(await screen.findByRole("link", { name: /Θάλασσα Πλατιά/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("heading", { name: "Select a song" })).not.toBeInTheDocument();
  });

  it("names a dead link as one", async () => {
    renderWithProviders(<TestApp />, { route: "/nowhere-at-all" });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  // The section has no screen of its own; its page redirects to the first tab.
  it("opens the admin console on its first tab", async () => {
    server.use(http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list<User>([]))));

    renderWithProviders(
      <>
        <TestApp />
        <CurrentAddress />
      </>,
      { route: "/admin", user: admin },
    );

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/users"));
  });
});
