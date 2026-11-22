import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/types";
import { API, list, listById, makeList, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import { TestApp } from "@/test/app";
import { CurrentAddress } from "@/test/routes";

/**
 * Has the reader's frame answer as the panes do side by side. jsdom has no
 * container width, so without this the catalog beside a song stays hidden and
 * reads nothing (`lib/catalogPane.ts`).
 */
function splitPanes(): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    if (element.classList.contains("reader-frame")) {
      Object.defineProperty(style, "overflowY", { value: "hidden" });
    }
    return style;
  });
}

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

    splitPanes();
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

  // A phone opening a song by its address: the list is in the page, hidden, and
  // reads nothing until it shows.
  it("reads no catalog for the list hidden beside a song", async () => {
    const catalogReads: string[] = [];
    const record = ({ request }: { request: Request }) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/v1/songs" || pathname === "/api/v1/genres") {
        catalogReads.push(pathname);
      }
    };
    server.events.on("request:start", record);
    // Removed even when an assertion fails, so it cannot record the next test.
    try {
      renderWithProviders(<TestApp />, { route: "/songs/thalassa-platia" });

      expect(
        await screen.findByRole("heading", { level: 1, name: "Θάλασσα Πλατιά" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("searchbox", { name: /search songs/i })).toBeInTheDocument();
    } finally {
      server.events.removeListener("request:start", record);
    }
    expect(catalogReads).toEqual([]);
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
