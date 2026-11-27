import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Profiler } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Layout, StickyHeader } from "./Layout";
import { CATALOG_SEARCH_ATTRIBUTE, SearchField } from "./SearchField";
import { modalIsOpen } from "@/lib/modal";
import { Link } from "@/lib/navigation";
import {
  CHROME_PROGRESS_PROPERTY,
  CHROME_SCRUBBING_ATTRIBUTE,
  CHROME_TUCKED_ATTRIBUTE,
  revealChrome,
} from "@/lib/scrollChrome";
import { catalogList } from "@/test/catalog";
import { API, list, listById, makeList, makeSong, makeUser } from "@/test/handlers";
import { recordRequests } from "@/test/requests";
import { renderWithProviders } from "@/test/render";
import { CurrentAddress } from "@/test/routes";
import {
  scrollDown,
  scrollEnd,
  scrollToY,
  scrollUp,
  setPageLength,
  setScrollY,
} from "@/test/scroll";
import { server } from "@/test/server";

// The chrome's scroll state reads the offset when its first bar mounts.
beforeEach(() => setScrollY(0));

/*
 * jsdom has no breakpoints, so the rail and the bottom bar are both in the
 * document; each is asserted separately. See `identityCard` in navItems.ts.
 */
const rail = () => screen.getByRole("complementary");
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

  it("reaches the profile from the rail's picture rather than a link", () => {
    renderWithProviders(<Layout />, { user: makeUser({ display_name: "Christos" }) });

    // Inside the `<nav>`, pinning the picture as part of the landmark.
    const nav = within(rail()).getByRole("navigation");
    expect(routesToProfile(nav)).toHaveLength(1);
    expect(routesToProfile(nav)[0]).toBe(within(nav).getByRole("link", { name: /Christos/ }));
  });

  // The rail draws icons alone; each link's label is its accessible name.
  it("names every link on the rail, the brand's mark leading home", () => {
    renderWithProviders(<Layout />, {
      user: makeUser({ display_name: "Christos", role: "admin" }),
    });

    const links = within(rail()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/",
      "/lists",
      "/admin",
      "/profile",
    ]);
    expect(links[0]).toHaveAccessibleName("Songfolio");
    expect(links.slice(1, 4).map((link) => link.textContent)).toEqual(["Browse", "Lists", "Admin"]);
    expect(links[4]).toHaveAccessibleName(/^Christos/);
  });

  it("offers no control to put the rail away", () => {
    renderWithProviders(<Layout />, { user: makeUser() });

    expect(within(rail()).queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the rail's link for a guest, who has no picture to press", () => {
    renderWithProviders(<Layout />, { user: null });

    expect(routesToProfile(within(rail()).getByRole("navigation"))).toHaveLength(1);
    expect(within(rail()).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  // A song has no entry of its own. It belongs to the list beside it: the one
  // its `?list=` names, or else the catalog.
  it.each([
    { route: "/", entry: "Browse" },
    { route: "/songs/thalassa-platia", entry: "Browse" },
    { route: "/lists", entry: "Lists" },
    { route: "/lists/list-1", entry: "Lists" },
    { route: "/songs/thalassa-platia?list=list-1", entry: "Lists" },
  ])("lights $entry, and only it, at $route, on the rail and the bar", ({ route, entry }) => {
    server.use(listById(makeList()));
    renderWithProviders(<Layout />, { route, user: makeUser() });

    expect(lit(rail())).toEqual([entry]);
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
  // link there), which stays lit across it. The rail keeps its own entry.
  it("leaves Admin to Profile, lit across the console", () => {
    renderWithProviders(<Layout />, {
      route: "/admin/genres",
      user: makeUser({ role: "admin" }),
    });

    expect(within(bar()).queryByRole("link", { name: "Admin" })).toBeNull();
    expect(lit(bar())).toEqual(["Profile"]);
    expect(lit(rail())).toEqual(["Admin"]);
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

  /** The bar's own box, which `lib/scrollChrome` writes the progress on. */
  const shell = () => bar().parentElement as HTMLElement;
  const progress = () => Number(shell().style.getPropertyValue(CHROME_PROGRESS_PROPERTY));
  const scrubbing = () => shell().hasAttribute(CHROME_SCRUBBING_ATTRIBUTE);

  // Momentum scrolling jitters by a few pixels either way.
  it("stays tucked through a little jitter up", () => {
    renderWithProviders(<Layout />);

    scrollToY(300);
    expect(tucked()).toBe(true);
    expect(progress()).toBe(1);

    // Back up, but by less than the jitter.
    scrollToY(295);
    expect(tucked()).toBe(true);
    scrollEnd();
    expect(tucked()).toBe(true);
    expect(progress()).toBe(1);
  });

  // A scroll only reads, and leaves its writes for the frame: a write would
  // make the next scroll's read of the page's height force a layout.
  it("draws a scroll in the frame after it, once", () => {
    renderWithProviders(<Layout />);
    const frames: FrameRequestCallback[] = [];
    const request = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => frames.push(callback));
    try {
      for (const y of [5, 10, 20]) {
        setScrollY(y);
        fireEvent.scroll(window);
      }
      expect(progress()).toBe(0);
      expect(tucked()).toBe(false);
      expect(frames).toHaveLength(1);

      act(() => frames[0]?.(performance.now()));
      expect(progress()).toBe(0.5);
      expect(scrubbing()).toBe(true);

      // The attribute on <html> waits for the frame too.
      for (const y of [30, 40]) {
        setScrollY(y);
        fireEvent.scroll(window);
      }
      expect(tucked()).toBe(false);
      act(() => frames[1]?.(performance.now()));
      expect(tucked()).toBe(true);
    } finally {
      request.mockRestore();
    }
  });

  // As Safari's toolbar: the bar shrinks with the scroll itself, from the
  // first pixel down, and grows with it on the way back.
  it("follows the scroll pixel for pixel, scrubbing while it does", () => {
    renderWithProviders(<Layout />);
    expect(scrubbing()).toBe(false);

    scrollToY(1);
    expect(progress()).toBe(0.025);
    expect(scrubbing()).toBe(true);
    scrollToY(10);
    expect(progress()).toBe(0.25);
    scrollToY(20);
    expect(progress()).toBe(0.5);
    // Not yet tucked: that waits for the whole stretch.
    expect(tucked()).toBe(false);
    scrollToY(40);
    expect(progress()).toBe(1);
    expect(tucked()).toBe(true);

    // Further down holds it at the end; the way back counts from wherever the
    // reader turned.
    scrollToY(400);
    scrollToY(390);
    expect(progress()).toBe(0.75);
    expect(tucked()).toBe(false);
    scrollToY(395);
    expect(progress()).toBe(0.875);
  });

  // Settled tucked within the first stretch, the way up shares out what is
  // left, so it is out by the top without a jump.
  it("comes out by the top without a jump", () => {
    renderWithProviders(<Layout />);

    scrollToY(20);
    scrollEnd();
    expect(progress()).toBe(1);

    scrollToY(19);
    expect(progress()).toBe(0.95);
    scrollToY(10);
    expect(progress()).toBe(0.5);
    scrollToY(0);
    expect(progress()).toBe(0);
  });

  // Once the scroll rests it finishes the way the reader went: tucked from
  // halfway down, out after a touch up.
  it("settles at one end when the scroll comes to rest", () => {
    renderWithProviders(<Layout />);

    // Less than halfway down: back out.
    scrollToY(15);
    scrollEnd();
    expect(progress()).toBe(0);
    expect(tucked()).toBe(false);
    expect(scrubbing()).toBe(false);

    // Halfway down: the rest of the way.
    scrollToY(35);
    scrollEnd();
    expect(progress()).toBe(1);
    expect(tucked()).toBe(true);

    // A touch up: out.
    scrollToY(25);
    scrollEnd();
    expect(progress()).toBe(0);
    expect(tucked()).toBe(false);
  });

  // iOS's bounce above the top: letting go there reads as a scroll down on
  // the way back, which must not tuck the chrome.
  it("stays out through the bounce at the top", () => {
    renderWithProviders(<Layout />);

    scrollToY(-30);
    scrollToY(-10);
    scrollToY(0);
    scrollEnd();

    expect(progress()).toBe(0);
    expect(tucked()).toBe(false);
  });

  // Brought out mid-bounce (a tap on the tab), the way back to the top is no
  // stretch down either.
  it("stays out at the top when brought out in the bounce", () => {
    renderWithProviders(<Layout />);

    setScrollY(-30);
    act(() => revealChrome());
    scrollToY(0);
    scrollEnd();

    expect(progress()).toBe(0);
    expect(tucked()).toBe(false);
  });

  // Jitter up at the end of a scroll down is no turn: it settles as down.
  it("settles by the way the reader went, not by the jitter", () => {
    renderWithProviders(<Layout />);

    scrollToY(25);
    scrollToY(24);
    scrollEnd();
    expect(progress()).toBe(1);
    expect(tucked()).toBe(true);
  });

  // A finger held on the screen leaves the bar where the scroll put it;
  // where the browser has no `scrollend`, a pause in the scroll events after
  // the finger lifts is the rest.
  it("waits for the finger to lift before it settles", () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<Layout />);

      fireEvent.touchStart(window);
      scrollToY(30);
      act(() => vi.advanceTimersByTime(1000));
      scrollEnd();
      expect(progress()).toBe(0.75);
      expect(scrubbing()).toBe(true);

      fireEvent.touchEnd(window);
      act(() => vi.advanceTimersByTime(100));
      expect(progress()).toBe(0.75);
      act(() => vi.advanceTimersByTime(100));
      expect(progress()).toBe(1);
      expect(tucked()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // A flick that tucks it on the way down must not bring it straight back on
  // arrival, nor iOS's bounce past the end, whose way back reads as a scroll
  // up. A touch up brings it out there as anywhere.
  it("stays as it is at the end of the page, through the bounce", () => {
    renderWithProviders(<Layout />);
    setPageLength(1000);

    scrollToY(500);
    expect(tucked()).toBe(true);

    // At the very end, then a bounce past it and back.
    scrollToY(1000);
    expect(tucked()).toBe(true);
    scrollToY(1040);
    scrollToY(1000);
    expect(tucked()).toBe(true);
    expect(progress()).toBe(1);

    scrollToY(960);
    expect(tucked()).toBe(false);
    expect(progress()).toBe(0);
  });

  // Brought out at the end (a tap on the pill), the bounce's way out is no
  // stretch down either.
  it("stays out at the end of the page, through the bounce", () => {
    renderWithProviders(<Layout />);
    setPageLength(1000);
    scrollToY(1000);
    expect(tucked()).toBe(true);

    act(() => revealChrome());
    scrollToY(1060);
    scrollToY(1000);
    scrollEnd();

    expect(tucked()).toBe(false);
    expect(progress()).toBe(0);
  });

  // The offset does not move here, so no scroll event brings it back. A link
  // on the page, not a tab: focus arriving in the bar would bring it back
  // whatever the navigation did.
  it("comes back on a new screen", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Layout>
        <Link href="/lists">Your lists</Link>
      </Layout>,
      { user: makeUser() },
    );
    scrollDown();
    expect(tucked()).toBe(true);

    await user.click(screen.getByRole("link", { name: "Your lists" }));

    await waitFor(() => expect(tucked()).toBe(false));
  });

  describe("a tap on the tab already lit", () => {
    const renderAt = (route: string) =>
      renderWithProviders(
        <Layout>
          <CurrentAddress />
        </Layout>,
        { route, user: makeUser() },
      );

    // As a phone's own apps do, and with the bars out at once. Smooth, or a
    // jump under reduced motion, is the root's `scroll-behavior` (index.css).
    it("goes back to the top of its screen rather than reloading it", async () => {
      const user = userEvent.setup();
      renderAt("/lists");
      scrollDown();
      // The shell's own scroll to the top of a new screen, on mount.
      vi.mocked(window.scrollTo).mockClear();

      await user.click(within(bar()).getByRole("link", { name: "Lists" }));

      expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0 });
      expect(tucked()).toBe(false);
      expect(screen.getByTestId("location")).toHaveTextContent(/^Now at \/lists$/);
    });

    // Lit on a list, Lists still leads back to the reader's lists.
    it("still leads to its screen from one below it", async () => {
      const user = userEvent.setup();
      server.use(listById(makeList()));
      renderAt("/lists/list-1");
      vi.mocked(window.scrollTo).mockClear();

      await user.click(within(bar()).getByRole("link", { name: "Lists" }));

      await waitFor(() =>
        expect(screen.getByTestId("location")).toHaveTextContent(/^Now at \/lists$/),
      );
      expect(window.scrollTo).not.toHaveBeenCalledWith({ top: 0 });
    });

    // Lit with filters set, Browse still clears them: the plain catalog is
    // another address.
    it("still leads to its screen from the same one filtered", async () => {
      const user = userEvent.setup();
      renderAt("/?q=thalassa");
      vi.mocked(window.scrollTo).mockClear();

      await user.click(within(bar()).getByRole("link", { name: "Browse" }));

      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^Now at \/$/));
      expect(window.scrollTo).not.toHaveBeenCalledWith({ top: 0 });
    });
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

    // On the whole bar, which the pill's words read the surface's scale from too.
    const measuredBar = () => {
      const measured = bar().closest<HTMLElement>(".bottom-bar");
      if (!measured) throw new Error("The bottom bar is missing.");
      return measured;
    };

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

        const measured = measuredBar();
        expect(Number(measured.style.getPropertyValue("--pill-sx"))).toBeCloseTo(1 / 3);
        expect(measured.style.getPropertyValue("--pill-sy")).toBe("0.4");
      } finally {
        restore();
      }
    });

    // From `md` up the bar is `display: none`, with nothing to measure.
    it("leaves the shrink alone while the bar is not laid out", () => {
      const restore = observeTheBarAtOnce();
      try {
        renderWithProviders(<Layout />, { route: "/profile" });

        const measured = measuredBar();
        expect(measured.style.getPropertyValue("--pill-sx")).toBe("");
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
  /**
   * The slide, under `max-md:` only, following the scroll's progress and held
   * while the header has focus (index.css).
   */
  const TUCKS = "max-md:chrome-follows max-md:chrome-slides-up";

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

  // As the bottom bar does: partway out of sight while the scroll is partway,
  // scrubbing while the reader moves it.
  it("follows the scroll", () => {
    render(<StickyHeader>Search</StickyHeader>);
    const progress = () => header()?.style.getPropertyValue(CHROME_PROGRESS_PROPERTY);

    scrollToY(20);
    expect(progress()).toBe("0.5");
    expect(header()).toHaveAttribute(CHROME_SCRUBBING_ATTRIBUTE);

    scrollToY(0);
    expect(progress()).toBe("0");
  });

  it("stays put while it is pinned", () => {
    // Beside a bar that tucks, so the page's tucking is running.
    render(
      <>
        <StickyHeader pinned>Search</StickyHeader>
        <StickyHeader>Tools</StickyHeader>
      </>,
    );

    expect(header()).toHaveClass("sticky-bar");
    // One at a time: a negated `toHaveClass` of several passes when any is missing.
    for (const name of TUCKS.split(" ")) expect(header()).not.toHaveClass(name);
    // Nothing reads the progress there, so none is written.
    scrollToY(20);
    expect(
      screen.getByText("Tools").closest("header")?.style.getPropertyValue(CHROME_PROGRESS_PROPERTY),
    ).toBe("0.5");
    expect(header()?.style.getPropertyValue(CHROME_PROGRESS_PROPERTY)).toBe("");
  });

  // A header pinned partway through a scroll keeps nothing the slide drew from.
  it("lets go of the progress once it is pinned", () => {
    const { rerender } = render(<StickyHeader>Search</StickyHeader>);
    scrollToY(20);
    expect(header()).toHaveAttribute(CHROME_SCRUBBING_ATTRIBUTE);

    rerender(<StickyHeader pinned>Search</StickyHeader>);

    expect(header()?.style.getPropertyValue(CHROME_PROGRESS_PROPERTY)).toBe("");
    expect(header()).not.toHaveAttribute(CHROME_SCRUBBING_ATTRIBUTE);
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
