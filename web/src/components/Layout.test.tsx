import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Layout, StickyHeader } from "./Layout";
import { MenuHeader } from "./SearchHeader";
import { modalIsOpen } from "@/lib/modal";
import { makeUser } from "@/test/handlers";
import { intersectAll } from "@/test/intersection";
import { renderWithProviders } from "@/test/render";
import { scrollDown, scrollUp, setScrollY } from "@/test/scroll";

/*
 * jsdom has no breakpoints, so the sidebar and the drawer are both in the
 * document; each is asserted separately. See `identityCard` in Layout.tsx.
 */
describe("Layout navigation", () => {
  // `hidden` throughout: a closed `<dialog>` is `display: none`.
  const sidebar = () => screen.getByRole("complementary");
  const drawer = () => screen.getByLabelText("Navigation");

  // By destination, not label, so a renamed entry is still caught; and inside
  // the `<nav>`, pinning the card as part of the landmark.
  const routesToProfile = (navigation: HTMLElement) =>
    within(within(navigation).getByRole("navigation", { hidden: true }))
      .getAllByRole("link", { hidden: true })
      .filter((link) => link.getAttribute("href") === "/profile");

  it("reaches the profile from the identity card rather than a link", () => {
    renderWithProviders(<Layout />, { user: makeUser({ display_name: "Christos" }) });

    for (const navigation of [sidebar(), drawer()]) {
      expect(routesToProfile(navigation)).toHaveLength(1);
      expect(routesToProfile(navigation)[0]).toBe(
        within(navigation).getByRole("link", { name: /Christos/, hidden: true }),
      );
    }
  });

  it("keeps the link for a guest, who has no identity card", () => {
    renderWithProviders(<Layout />, { user: null });

    expect(routesToProfile(sidebar())).toHaveLength(1);
    expect(routesToProfile(drawer())).toHaveLength(1);
  });

  it("offers a guest the way in from either navigation", () => {
    renderWithProviders(<Layout />, { user: null });

    expect(within(sidebar()).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(
      within(drawer()).getByRole("link", { name: "Sign in", hidden: true }),
    ).toBeInTheDocument();
  });
});

describe("Mobile navigation drawer", () => {
  /** The shell plus a header to render the trigger, which the shell does not. */
  const renderShell = () =>
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MenuHeader />} />
        </Route>
      </Routes>,
      { user: null },
    );

  // The trigger is outside the dialog, so it is inert while the drawer is up.
  const trigger = () => screen.getByRole("button", { name: "Open menu", hidden: true });

  /*
   * jsdom has no layout or scroll snap, so the slide is the stub observer
   * reporting where the sheet is: on screen once it has slid in, gone once
   * it has slid out.
   */
  const openDrawer = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(trigger());
    act(() => intersectAll(1));
  };
  const slidOut = () => act(() => intersectAll(0));

  // The drawer stays mounted; a modal while closed, it would disable the song
  // page's swipe and arrow keys for the whole session.
  it("is no modal at all while it is closed", () => {
    renderShell();

    expect(modalIsOpen()).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).toHaveAttribute(
      "aria-controls",
      screen.getByRole("dialog", { hidden: true }).id,
    );
  });

  it("opens on the hamburger as a modal and says so", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());

    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
    expect(modalIsOpen()).toBe(true);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  // Escape's `cancel` is turned into the slide, so the dialog stays modal
  // until the sheet is off-screen, and only then closes.
  it("slides out on Escape, closing once the sheet has gone", async () => {
    const user = userEvent.setup();
    renderShell();

    await openDrawer(user);
    await user.keyboard("{Escape}");

    expect(modalIsOpen()).toBe(true);

    slidOut();

    expect(modalIsOpen()).toBe(false);
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
  });

  it("slides out on a tap on the dim, and not on one on the sheet", async () => {
    const user = userEvent.setup();
    renderShell();

    await openDrawer(user);
    const scrolls = vi.mocked(Element.prototype.scrollTo);
    scrolls.mockClear();
    const dialog = screen.getByRole("dialog");

    // The sheet's own padding, then the dim beside it, which is the dialog.
    fireEvent.click(within(dialog).getByRole("navigation").parentElement as HTMLElement);
    expect(scrolls).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(scrolls).toHaveBeenCalledTimes(1);

    slidOut();

    expect(modalIsOpen()).toBe(false);
  });

  // Swiped away, nothing in the app asked: the observer alone closes it.
  it("closes when the sheet is swiped off-screen", async () => {
    const user = userEvent.setup();
    renderShell();

    await openDrawer(user);
    slidOut();

    expect(modalIsOpen()).toBe(false);
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
  });

  // WebKit gives them to the page behind: Home and End from anywhere, the
  // rest from a link in the list, since the dialog scrolls only sideways.
  it("keeps the vertical scrolling keys from the page while open, and only then", async () => {
    const user = userEvent.setup();
    renderShell();
    const taken = (key: string) => !fireEvent.keyDown(document.body, { key });
    const keys = ["End", "Home", "PageDown", "PageUp", "ArrowDown", " "];

    for (const key of keys) expect(taken(key)).toBe(false);

    await openDrawer(user);

    for (const key of keys) expect(taken(key)).toBe(true);
  });

  // Where it starts, before the slide in, is off-screen too.
  it("does not mistake the sheet's starting position for a dismissal", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    slidOut();

    expect(modalIsOpen()).toBe(true);
  });

  // Browse is the current screen, so the pathname does not change.
  it("closes on arriving, even where it was already", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Browse" }));

    expect(modalIsOpen()).toBe(false);
  });

  // `close()` does this; the drawer only has to call it rather than unmount.
  it("hands focus back to the hamburger", async () => {
    const user = userEvent.setup();
    renderShell();

    await openDrawer(user);
    await user.keyboard("{Escape}");
    slidOut();

    expect(trigger()).toHaveFocus();
  });

  // The suite-wide `matchMedia` stub never changes and registers no listeners,
  // so this installs one that can cross the breakpoint.
  it("stops being open once the window is too wide for it", async () => {
    const user = userEvent.setup();
    const crossInto = stubBreakpoint();
    renderShell();

    await openDrawer(user);
    expect(modalIsOpen()).toBe(true);

    crossInto(true);
    slidOut();

    expect(modalIsOpen()).toBe(false);
  });
});

/**
 * A `window.matchMedia` whose answer can be changed, returning the function that
 * changes it. Restored by the `afterEach` below.
 */
let restoreMatchMedia: (() => void) | undefined;

afterEach(() => {
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
});

function stubBreakpoint() {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: false,
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => {
      listeners.delete(fn);
    },
  };

  const previous = window.matchMedia;
  window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
  restoreMatchMedia = () => {
    window.matchMedia = previous;
  };

  return (matches: boolean) => {
    query.matches = matches;
    act(() => {
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
    });
  };
}

/*
 * jsdom has no breakpoints, so the `max-md:` class is the readable form of
 * "hides on a phone, sticky at a desk". Pinned on the shared component rather
 * than through either page.
 */
describe("StickyHeader", () => {
  beforeEach(() => setScrollY(0));

  // Use `toHaveClass`, so negative assertions fail on a missing element and
  // whole class names are matched.
  const header = () => screen.getByText("Search").closest("header");

  it("gets out of the way on the way down, and only on a phone", () => {
    render(<StickyHeader>Search</StickyHeader>);

    scrollDown();

    expect(header()).toHaveClass("max-md:-translate-y-full");
    expect(header()).not.toHaveClass("-translate-y-full");
  });

  it("comes back on the way up", () => {
    render(<StickyHeader>Search</StickyHeader>);

    scrollDown();
    scrollUp();

    expect(header()).not.toHaveClass("max-md:-translate-y-full");
  });

  it("stays put while it is pinned", () => {
    render(<StickyHeader pinned>Search</StickyHeader>);

    scrollDown();

    expect(header()).not.toHaveClass("max-md:-translate-y-full");
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
