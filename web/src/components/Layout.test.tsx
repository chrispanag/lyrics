import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Profiler } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Layout, StickyHeader } from "./Layout";
import { CATALOG_SEARCH_ATTRIBUTE, SearchField } from "./SearchField";
import { MenuHeader } from "./SearchHeader";
import { NAV_COLLAPSED_ATTRIBUTE } from "@/lib/navCollapsed";
import { modalIsOpen } from "@/lib/modal";
import { CHROME_TUCKED_ATTRIBUTE } from "@/lib/scrollChrome";
import { catalogList } from "@/test/catalog";
import { API, list, listById, makeList, makeSong, makeUser } from "@/test/handlers";
import { recordRequests } from "@/test/requests";
import { renderWithProviders } from "@/test/render";
import { CurrentAddress } from "@/test/routes";
import { scrollDown, scrollToY, scrollUp, setScrollY } from "@/test/scroll";
import { server } from "@/test/server";

// The chrome's scroll state reads the offset when its first bar mounts.
beforeEach(() => setScrollY(0));

/*
 * jsdom has no breakpoints, so the sidebar and the bottom bar are both in the
 * document; each is asserted separately. See `identityCard` in navItems.ts.
 */
const sidebar = () => screen.getByRole("complementary");
const bar = () => screen.getByRole("navigation", { name: "Navigation" });

/**
 * The links a navigation lights, by their names: a signed-in Profile tab
 * holds the reader's initials too, which are hidden from that name.
 */
const lit = (navigation: HTMLElement) => {
  const links = within(navigation).queryAllByRole("link", { current: "page" });
  const names = ["Browse", "Lists", "Profile", "Admin"].filter((name) =>
    links.includes(within(navigation).queryByRole("link", { name }) as HTMLElement),
  );
  // Every lit link is one of the entries.
  expect(names).toHaveLength(links.length);
  return names;
};

describe("Layout navigation", () => {
  // By destination, not label, so a renamed entry is still caught.
  const routesToProfile = (navigation: HTMLElement) =>
    within(navigation)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/profile");

  it("reaches the profile from the column's identity card rather than a link", () => {
    renderWithProviders(<Layout />, { user: makeUser({ display_name: "Christos" }) });

    // Inside the `<nav>`, pinning the card as part of the landmark.
    const column = within(sidebar()).getByRole("navigation");
    expect(routesToProfile(column)).toHaveLength(1);
    expect(routesToProfile(column)[0]).toBe(within(column).getByRole("link", { name: /Christos/ }));
  });

  it("keeps the column's link for a guest, who has no identity card", () => {
    renderWithProviders(<Layout />, { user: null });

    expect(routesToProfile(within(sidebar()).getByRole("navigation"))).toHaveLength(1);
    expect(within(sidebar()).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  // A song has no entry of its own. It belongs to the list beside it: the one
  // its `?list=` names, or else the catalog.
  it.each([
    { route: "/", entry: "Browse" },
    { route: "/songs/thalassa-platia", entry: "Browse" },
    { route: "/lists", entry: "Lists" },
    { route: "/lists/list-1", entry: "Lists" },
    { route: "/songs/thalassa-platia?list=list-1", entry: "Lists" },
  ])("lights $entry, and only it, at $route, in the column and the bar", ({ route, entry }) => {
    server.use(listById(makeList()));
    renderWithProviders(<Layout />, { route, user: makeUser() });

    expect(lit(sidebar())).toEqual([entry]);
    expect(lit(bar())).toEqual([entry]);
  });
});

describe("Lists link prefetch", () => {
  const listsLink = () =>
    within(screen.getByRole("complementary")).getByRole("link", { name: "Lists" });

  it("loads the lists on a press when signed in", async () => {
    const requests = recordRequests((path) => path === "/api/v1/lists");
    try {
      renderWithProviders(<Layout />, { user: makeUser() });
      fireEvent.pointerDown(listsLink());

      await waitFor(() => expect(requests.paths).toEqual(["/api/v1/lists"]));
    } finally {
      requests.stop();
    }
  });

  it("loads the lists on focus when signed in", async () => {
    const requests = recordRequests((path) => path === "/api/v1/lists");
    try {
      renderWithProviders(<Layout />, { user: makeUser() });
      act(() => listsLink().focus());

      await waitFor(() => expect(requests.paths).toEqual(["/api/v1/lists"]));
    } finally {
      requests.stop();
    }
  });

  it("loads them from the bar's tab too", async () => {
    const requests = recordRequests((path) => path === "/api/v1/lists");
    try {
      renderWithProviders(<Layout />, { user: makeUser() });
      fireEvent.pointerDown(within(bar()).getByRole("link", { name: "Lists" }));

      await waitFor(() => expect(requests.paths).toEqual(["/api/v1/lists"]));
    } finally {
      requests.stop();
    }
  });

  // A guest has no Lists link; what is left must not ask for lists either.
  it("loads nothing for a guest", async () => {
    const requests = recordRequests((path) => path === "/api/v1/lists");
    try {
      renderWithProviders(<Layout />, { user: null });
      expect(screen.queryByRole("link", { name: "Lists" })).toBeNull();
      for (const link of screen.getAllByRole("link")) {
        fireEvent.pointerDown(link);
        act(() => link.focus());
      }
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(requests.paths).toEqual([]);
    } finally {
      requests.stop();
    }
  });
});

describe("Bottom bar", () => {
  const tabs = () => within(bar()).getAllByRole("link");
  const searchButton = () => within(bar()).getByRole("button", { name: "Search" });
  /** Tucked is an attribute on <html>; index.css draws it. */
  const tucked = () => document.documentElement.hasAttribute(CHROME_TUCKED_ATTRIBUTE);

  it("offers a reader Browse, Lists and their Profile, and Search", () => {
    renderWithProviders(<Layout />, { user: makeUser({ display_name: "Christos" }) });

    // By name: the Profile tab holds the reader's initials too, hidden from it.
    for (const [index, name] of ["Browse", "Lists", "Profile"].entries()) {
      expect(tabs()[index]).toBe(within(bar()).getByRole("link", { name }));
    }
    expect(tabs().map((tab) => tab.getAttribute("href"))).toEqual(["/", "/lists", "/profile"]);
    expect(searchButton()).toBeInTheDocument();
  });

  // The theme switch lives on Profile, and so does the way in.
  it("offers a guest Browse and Profile, and no Lists", () => {
    renderWithProviders(<Layout />, { user: null });

    expect(tabs().map((tab) => tab.textContent)).toEqual(["Browse", "Profile"]);
  });

  // A phone reaches the console from Profile (ProfilePage's spec holds the
  // link there), which stays lit across it. The column keeps its own entry.
  it("leaves Admin to Profile, lit across the console", () => {
    renderWithProviders(<Layout />, {
      route: "/admin/genres",
      user: makeUser({ role: "admin" }),
    });

    expect(within(bar()).queryByRole("link", { name: "Admin" })).toBeNull();
    expect(lit(bar())).toEqual(["Profile"]);
    expect(lit(sidebar())).toEqual(["Admin"]);
  });

  it("lights Profile on the profile", () => {
    renderWithProviders(<Layout />, { route: "/profile", user: makeUser() });

    expect(lit(bar())).toEqual(["Profile"]);
  });

  it("is a landmark, out from the start", () => {
    renderWithProviders(<Layout />);

    expect(bar().tagName).toBe("NAV");
    expect(tucked()).toBe(false);
  });

  it("tucks away on the way down and comes back on the way up", () => {
    renderWithProviders(<Layout />);

    scrollDown();
    expect(tucked()).toBe(true);

    scrollUp();
    expect(tucked()).toBe(false);
  });

  // Collapsed is only how it looks: a screen reader still reaches every tab.
  it("keeps its tabs in the accessibility tree while tucked", () => {
    renderWithProviders(<Layout />, { user: makeUser() });

    scrollDown();

    expect(tucked()).toBe(true);
    expect(bar()).not.toHaveAttribute("aria-hidden");
    expect(within(bar()).getByRole("link", { name: "Lists" })).toBeInTheDocument();
  });

  // Momentum scrolling jitters by a few pixels either way, and the first
  // stretch of a page has nothing to give room to.
  it("does not move for a small scroll, or near the top", () => {
    renderWithProviders(<Layout />);

    scrollToY(6);
    expect(tucked()).toBe(false);

    scrollToY(60);
    expect(tucked()).toBe(false);

    scrollToY(300);
    expect(tucked()).toBe(true);

    // Back up, but by less than the jitter.
    scrollToY(295);
    expect(tucked()).toBe(true);
  });

  // A nudge while reading is not a decision to read on; reaching for the bars
  // is a touch up, and they come at once.
  it("tucks only after a stretch down, counted from the turn, and comes back on a touch up", () => {
    renderWithProviders(<Layout />);

    // From the edge of the top, where the chrome is always out.
    scrollToY(80);
    scrollToY(115);
    expect(tucked()).toBe(false);

    // A turn up and back down starts the count over from the highest point.
    scrollToY(100);
    scrollToY(135);
    expect(tucked()).toBe(false);
    scrollToY(145);
    expect(tucked()).toBe(true);

    // Further down moves the turn with it, so the way back counts from there.
    scrollToY(600);
    scrollToY(590);
    expect(tucked()).toBe(false);
  });

  // As Safari's toolbar does: the reader has finished, and iOS's bounce at the
  // end reads as a short scroll up anyway.
  it("comes back at the end of the page", () => {
    renderWithProviders(<Layout />);
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(
      window.innerHeight + 1000,
    );

    scrollToY(500);
    expect(tucked()).toBe(true);

    scrollToY(990);
    expect(tucked()).toBe(false);
  });

  // The offset does not move here, so no scroll event brings it back.
  it("comes back on a new screen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Layout />, { user: makeUser() });
    scrollDown();
    expect(tucked()).toBe(true);

    await user.click(within(bar()).getByRole("link", { name: "Lists" }));

    await waitFor(() => expect(tucked()).toBe(false));
  });

  it("comes back when anything in it takes focus", () => {
    renderWithProviders(<Layout />);
    scrollDown();

    act(() => within(bar()).getByRole("link", { name: "Browse" }).focus());

    expect(tucked()).toBe(false);
  });

  // The pill is for the eye and the thumb: hidden from a screen reader, which
  // has the tabs, and out of the tab order.
  it("comes back on a tap on the pill", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Layout />);
    scrollDown();

    const pill = container.querySelector<HTMLElement>(".bottom-bar-pill");
    expect(pill).toHaveAttribute("aria-hidden", "true");
    expect(pill).toHaveAttribute("tabindex", "-1");
    await user.click(pill as HTMLElement);

    expect(tucked()).toBe(false);
  });

  describe("pill", () => {
    const pill = () => document.querySelector<HTMLElement>(".bottom-bar-pill");

    it("names the song being read", async () => {
      renderWithProviders(<Layout />, { route: "/songs/thalassa-platia" });

      await waitFor(() => expect(pill()).toHaveTextContent("Θάλασσα Πλατιά"));
    });

    it("names the list and the place in it for a song read from one", async () => {
      server.use(
        listById(catalogList(3)),
        http.get(`${API}/api/v1/songs/:id`, () =>
          HttpResponse.json(makeSong({ id: "song-2", slug: "frangosyriani" })),
        ),
      );
      renderWithProviders(<Layout />, { route: "/songs/frangosyriani?list=list-1" });

      // Two spans a flex gap apart, so no space between them in the text.
      await waitFor(() => expect(pill()).toHaveTextContent(/^Ρεμπέτικα\s*· 2 of 3$/));
    });

    it("names the screen anywhere else", () => {
      renderWithProviders(<Layout />, { route: "/profile" });

      expect(pill()).toHaveTextContent("Profile");
    });

    // One rule (`currentEntry`) for both, so the pill never names a tab other
    // than the one lit: an address no entry claims is the catalog's, and the
    // console is Profile's on a phone.
    it.each([
      { route: "/people/x", role: "user" as const, entry: "Browse" },
      { route: "/admin", role: "admin" as const, entry: "Profile" },
    ])("names the tab it lights at $route", ({ route, role, entry }) => {
      renderWithProviders(<Layout />, { route, user: makeUser({ role }) });

      expect(lit(bar())).toEqual([entry]);
      expect(pill()).toHaveTextContent(entry);
    });

    // A guest has no Lists tab, so on a song read from a shared list the pill
    // names the list and no tab claims it: Browse lit would contradict it.
    it("lights no tab for a guest reading a song from a list", async () => {
      server.use(
        listById(catalogList(3)),
        http.get(`${API}/api/v1/songs/:id`, () =>
          HttpResponse.json(makeSong({ id: "song-2", slug: "frangosyriani" })),
        ),
      );
      renderWithProviders(<Layout />, { route: "/songs/frangosyriani?list=list-1", user: null });

      await waitFor(() => expect(pill()).toHaveTextContent(/^Ρεμπέτικα/));
      expect(lit(bar())).toEqual([]);
    });

    /**
     * Swaps in an observer that reports the bottom bar's boxes as soon as they
     * are watched, and hands back the setup file's. Only the bar's: the other
     * observers in the shell read entries this one does not make.
     */
    function observeTheBarAtOnce(): () => void {
      const setupStub = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        readonly callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          if (target.closest(".bottom-bar")) this.callback([], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      };
      return () => {
        globalThis.ResizeObserver = setupStub;
      };
    }

    // index.css shrinks the tabs' surface by these to the pill's face; the
    // stories measure the result in a real browser.
    it("measures the shrink from the face to the bar", () => {
      const face = (element: HTMLElement) => element.classList.contains("bottom-bar-pill-face");
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return face(this) ? 120 : 360;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return face(this) ? 24 : 60;
      });
      const restore = observeTheBarAtOnce();
      try {
        renderWithProviders(<Layout />, { route: "/profile" });

        const surface = bar();
        expect(Number(surface.style.getPropertyValue("--pill-sx"))).toBeCloseTo(1 / 3);
        expect(surface.style.getPropertyValue("--pill-sy")).toBe("0.4");
      } finally {
        restore();
      }
    });

    // From `md` up the bar is `display: none`, with nothing to measure.
    it("leaves the shrink alone while the bar is not laid out", () => {
      const restore = observeTheBarAtOnce();
      try {
        renderWithProviders(<Layout />, { route: "/profile" });

        const surface = bar();
        expect(surface.style.getPropertyValue("--pill-sx")).toBe("");
      } finally {
        restore();
      }
    });
  });
});

describe("Search sheet", () => {
  const searchButton = () => within(bar()).getByRole("button", { name: "Search" });
  const box = () => screen.getByRole("combobox", { name: /search songs/i });

  const matches = [
    makeSong({ id: "song-2", slug: "to-tragoydi-tis-limnis", title: "Το Τραγούδι της Λίμνης" }),
  ];

  /** The shell on a song, with the address beside it. */
  const renderShell = () =>
    renderWithProviders(
      <Layout>
        <CurrentAddress />
      </Layout>,
      { route: "/songs/thalassa-platia" },
    );

  it("opens full screen with the field focused", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(searchButton());

    expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
    expect(modalIsOpen()).toBe(true);
    expect(box()).toHaveFocus();
  });

  it("goes to the song chosen, and closes behind it", async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list(matches))));
    renderShell();

    await user.click(searchButton());
    await user.type(box(), "λίμν");
    await user.click(await screen.findByRole("option", { name: /Λίμνης/ }));

    expect(screen.getByText("Now at /songs/to-tragoydi-tis-limnis")).toBeInTheDocument();
    expect(modalIsOpen()).toBe(false);
  });

  // The sheet is all search, so a press inside it that is not on a result
  // leaves the results up.
  it("keeps the results up for a press elsewhere in the sheet", async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list(matches))));
    renderShell();

    await user.click(searchButton());
    await user.type(box(), "λίμν");
    await screen.findByRole("listbox");
    fireEvent.pointerDown(screen.getByRole("heading", { name: "Search" }));

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("closes on Escape, from the field too", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(searchButton());
    await user.type(box(), "λίμν");
    await user.keyboard("{Escape}");

    expect(modalIsOpen()).toBe(false);
    await waitFor(() => expect(searchButton()).toHaveFocus());
  });

  // Browse is the search: its own field, filters and every match. The button
  // goes there rather than putting a second search over it.
  it("goes to the catalog's own field on Browse, opening nothing", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Layout>
        <SearchField value="" onChange={() => {}} {...{ [CATALOG_SEARCH_ATTRIBUTE]: "" }} />
      </Layout>,
      { route: "/" },
    );
    scrollDown();

    await user.click(searchButton());

    expect(screen.getByRole("searchbox", { name: /search songs/i })).toHaveFocus();
    expect(modalIsOpen()).toBe(false);
    // And the chrome is out, the header holding that field with it.
    expect(document.documentElement).not.toHaveAttribute(CHROME_TUCKED_ATTRIBUTE);
  });
});

describe("Collapsible navigation", () => {
  const renderShell = () =>
    renderWithProviders(
      <Layout>
        <MenuHeader />
      </Layout>,
      { user: makeUser({ display_name: "Christos" }) },
    );
  const collapsed = () => document.documentElement.hasAttribute(NAV_COLLAPSED_ATTRIBUTE);

  it("starts open, and applies a choice already stored", () => {
    const { unmount } = renderShell();
    expect(collapsed()).toBe(false);
    unmount();

    localStorage.setItem("lyrics:nav-collapsed", "1");
    renderShell();
    expect(collapsed()).toBe(true);
  });

  it("hides the column from its own button and opens it again from the menu", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Hide navigation" }));

    expect(collapsed()).toBe(true);
    expect(localStorage.getItem("lyrics:nav-collapsed")).toBe("1");
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expect(collapsed()).toBe(false);
    expect(localStorage.getItem("lyrics:nav-collapsed")).toBeNull();
    expect(modalIsOpen()).toBe(false);
    expect(sidebar().contains(document.activeElement)).toBe(true);
  });
});

/*
 * jsdom has no breakpoints and no style sheet, so the tucked attribute on
 * <html> and the class that slides the header by it are the readable form of
 * "hides on a phone, sticky at a desk". Pinned on the shared component rather
 * than through either page.
 */
describe("StickyHeader", () => {
  // Use `toHaveClass`, so negative assertions fail on a missing element and
  // whole class names are matched.
  const header = () => screen.getByText("Search").closest("header");
  const tucked = () => document.documentElement.hasAttribute(CHROME_TUCKED_ATTRIBUTE);
  /** The slide, under `max-md:` only, and held while the header has focus (index.css). */
  const TUCKS = "max-md:chrome-tucked:-translate-y-full";

  it("gets out of the way on the way down, and only on a phone", () => {
    render(<StickyHeader>Search</StickyHeader>);
    expect(header()).toHaveClass("sticky-bar", TUCKS);
    expect(tucked()).toBe(false);

    scrollDown();

    expect(tucked()).toBe(true);
  });

  it("comes back on the way up", () => {
    render(<StickyHeader>Search</StickyHeader>);

    scrollDown();
    scrollUp();

    expect(tucked()).toBe(false);
  });

  it("stays put while it is pinned", () => {
    render(<StickyHeader pinned>Search</StickyHeader>);

    expect(header()).toHaveClass("sticky-bar");
    expect(header()).not.toHaveClass(TUCKS);
  });

  // Nothing is left behind for the next page, whose bars start out.
  it("takes the attribute away with the last bar", () => {
    const { unmount } = render(<StickyHeader>Search</StickyHeader>);
    scrollDown();
    expect(tucked()).toBe(true);

    unmount();

    expect(tucked()).toBe(false);
  });

  // One scroll moves every bar: each reads the page's one answer, rather than
  // counting from wherever the page was when it mounted.
  it("moves with the bottom bar", () => {
    renderWithProviders(
      <Layout>
        <StickyHeader>Tools</StickyHeader>
      </Layout>,
    );

    scrollDown();

    expect(screen.getByText("Tools").closest("header")).toHaveClass(TUCKS);
    expect(tucked()).toBe(true);
  });

  // A tuck is drawn by CSS from the attribute: neither the header nor the
  // bar, nor anything under them, renders for it.
  it("renders nothing for a tuck", () => {
    const commits = vi.fn();
    renderWithProviders(
      <Profiler id="shell" onRender={commits}>
        <Layout>
          <StickyHeader>Tools</StickyHeader>
        </Layout>
      </Profiler>,
    );
    commits.mockClear();

    scrollDown();
    expect(tucked()).toBe(true);
    scrollUp();
    expect(tucked()).toBe(false);

    expect(commits).not.toHaveBeenCalled();
  });

  /*
   * The suite-wide ResizeObserver never calls back, so this one answers on
   * `observe`, the way a browser's first notification does, and jsdom's
   * `offsetHeight` (always 0) is given a height to report.
   */
  it("publishes its height for the root's scroll padding, and withdraws it", () => {
    class AnsweringResizeObserver {
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    const suiteObserver = globalThis.ResizeObserver;
    vi.stubGlobal("ResizeObserver", AnsweringResizeObserver);
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(57);
    const published = () =>
      document.documentElement.style.getPropertyValue("--sticky-header-height");

    try {
      const { unmount } = render(<StickyHeader>Search</StickyHeader>);

      expect(published()).toBe("57px");
      // What index.css keys the in-header focus rule on.
      expect(header()).toHaveAttribute("data-sticky-header");

      unmount();

      expect(published()).toBe("");
    } finally {
      height.mockRestore();
      vi.stubGlobal("ResizeObserver", suiteObserver);
    }
  });
});
