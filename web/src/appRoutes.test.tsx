import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/types";
import { catalogList } from "@/test/catalog";
import { API, list, listById, makeList, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { recordRequests } from "@/test/requests";
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
 * Every screen inside the shell offers a phone's bottom bar and the desk's
 * rail. The shell supplies both, so only the app directory itself, composed by
 * position (`test/app.tsx`), can check that every screen sits inside it; a
 * miss leaves a reader on a screen they cannot navigate off.
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

  it.each(SCREENS)("offers the navigation at $route", async ({ route, user = null }) => {
    // Not covered by the default handlers; they only have to answer.
    server.use(
      listById(makeList()),
      http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list<User>([]))),
    );

    renderWithProviders(<TestApp />, { route, user });

    const bar = await screen.findByRole("navigation", { name: "Navigation" });
    expect(within(bar).getByRole("link", { name: "Browse" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Search" })).toBeInTheDocument();
    // The desk's rail: jsdom has no breakpoints, so it is here beside the bar.
    const rail = screen.getByRole("link", { name: "Songfolio" }).closest("aside")!;
    expect(within(rail).getByRole("link", { name: "Browse" })).toBeInTheDocument();
  });

  // The credential screens have no navigation by design.
  it.each(["/login", "/register", "/forgot-password"])("offers none at %s", async (route) => {
    renderWithProviders(<TestApp />, { route });

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Songfolio" })).not.toBeInTheDocument();
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
    // jsdom has no container width; the class is what makes the list a sheet
    // once the panes sit side by side. The region itself does not scroll: the
    // scrollbar belongs to the songs under the search.
    const songs = screen.getByRole("region", { name: "Songs" });
    expect(songs).toHaveClass("@3xl/app:rounded-card", "@3xl/app:sheet-surface");
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
    const catalog = recordRequests(
      (pathname) => pathname === "/api/v1/songs" || pathname === "/api/v1/genres",
    );
    try {
      renderWithProviders(<TestApp />, { route: "/songs/thalassa-platia" });

      expect(
        await screen.findByRole("heading", { level: 1, name: "Θάλασσα Πλατιά" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("searchbox", { name: /search songs/i })).toBeInTheDocument();
    } finally {
      catalog.stop();
    }
    expect(catalog.paths).toEqual([]);
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

/*
 * A list takes the catalog's place beside the lyrics: on its own page, and
 * beside a song read from it, however the reader arrived at the song.
 */
describe("A list beside the lyrics", () => {
  it("puts a list where the catalog goes, and an empty pane beside it", async () => {
    server.use(listById(catalogList(3)));
    splitPanes();
    renderWithProviders(<TestApp />, { route: "/lists/list-1" });

    const songs = screen.getByRole("region", { name: "Songs" });
    expect(
      await within(songs).findByRole("heading", { level: 1, name: "Ρεμπέτικα" }),
    ).toBeInTheDocument();
    expect(
      within(songs).getAllByRole("link", { name: /Θάλασσα Πλατιά|Φραγκοσυριανή/ }),
    ).toHaveLength(2);
    expect(within(songs).queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select a song" })).toBeInTheDocument();
  });

  // Loaded or reloaded at its own address, a song has no list to keep: the
  // slot's default reads `?list=` and builds the list, not the catalog.
  it("puts the list a song is read from beside it, the song marked", async () => {
    server.use(listById(catalogList(3)));
    splitPanes();
    renderWithProviders(<TestApp />, { route: "/songs/thalassa-platia?list=list-1" });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Θάλασσα Πλατιά" }),
    ).toBeInTheDocument();
    const songs = screen.getByRole("region", { name: "Songs" });
    expect(
      await within(songs).findByRole("heading", { level: 2, name: "Ρεμπέτικα" }),
    ).toBeInTheDocument();
    expect(within(songs).queryByRole("searchbox")).not.toBeInTheDocument();
    expect(within(songs).getByRole("link", { name: /Θάλασσα Πλατιά/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(songs).getByRole("link", { name: /Φραγκοσυριανή/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // `TestApp` mounts each address fresh, so this is where the click lands;
  // `ReaderSplit.test.tsx` pins that the list the router keeps is the same one.
  it("follows a song opened from the list with the list beside it", async () => {
    server.use(listById(catalogList(3)));
    splitPanes();
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <TestApp />
        <CurrentAddress />
      </>,
      { route: "/lists/list-1" },
    );

    await user.click(await screen.findByRole("link", { name: /Φραγκοσυριανή/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/songs/frangosyriani?list=list-1");
    const songs = screen.getByRole("region", { name: "Songs" });
    expect(
      await within(songs).findByRole("link", { name: /Φραγκοσυριανή/, current: "page" }),
    ).toBeInTheDocument();
    expect(within(songs).getByRole("heading", { level: 2, name: "Ρεμπέτικα" })).toBeInTheDocument();
  });

  // Below the split the address picks one pane, as it always has: the list on
  // its own page, and the song, with a Back that names the list.
  it("keeps one pane at a time below the split", async () => {
    server.use(listById(catalogList(3)));
    const { unmount } = renderWithProviders(<TestApp />, { route: "/lists/list-1" });

    expect(await screen.findByRole("heading", { level: 1, name: "Ρεμπέτικα" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Songs" })).not.toHaveClass("@max-3xl/app:hidden");
    expect(
      screen.getByRole("heading", { name: "Select a song" }).closest(".\\@max-3xl\\/app\\:hidden"),
    ).not.toBeNull();
    unmount();

    renderWithProviders(<TestApp />, { route: "/songs/thalassa-platia?list=list-1" });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Θάλασσα Πλατιά" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Songs" })).toHaveClass("@max-3xl/app:hidden");
    // Back names the list and the place in it, hidden only once the list is
    // beside the song, which then says the same.
    expect(await screen.findByRole("button", { name: "Back to Ρεμπέτικα, 1 of 3" })).toHaveClass(
      "@3xl/app:hidden",
    );
  });
});
