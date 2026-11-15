import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Layout, StickyHeader } from "./Layout";
import { MenuHeader } from "./SearchHeader";
import { modalIsOpen } from "@/lib/modal";
import { makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { scrollDown, scrollUp, setScrollY } from "@/test/scroll";

/*
 * jsdom has no breakpoints, so the sidebar and the drawer are both in the
 * document; each is asserted separately. See `identityCard` in Layout.tsx.
 */
describe("Layout navigation", () => {
  // The drawer by its label: it has `role="dialog"` only while open.
  const sidebar = () => screen.getByRole("complementary");
  const drawer = () => screen.getByLabelText("Navigation");

  // By destination, not label, so a renamed entry is still caught; and inside
  // the `<nav>`, pinning the card as part of the landmark.
  const routesToProfile = (navigation: HTMLElement) =>
    within(within(navigation).getByRole("navigation"))
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/profile");

  it("reaches the profile from the identity card rather than a link", () => {
    renderWithProviders(<Layout />, { user: makeUser({ display_name: "Christos" }) });

    for (const navigation of [sidebar(), drawer()]) {
      expect(routesToProfile(navigation)).toHaveLength(1);
      expect(routesToProfile(navigation)[0]).toBe(
        within(navigation).getByRole("link", { name: /Christos/ }),
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
    expect(within(drawer()).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
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

  const trigger = () => screen.getByRole("button", { name: "Open menu" });

  // The drawer stays mounted; marked as a modal while closed, it would disable
  // the song page's swipe and arrow keys for the whole session.
  it("is no modal at all while it is closed", () => {
    renderShell();

    expect(modalIsOpen()).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on the hamburger and says so", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());

    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
    expect(modalIsOpen()).toBe(true);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  // The drawer is the last user of the `<body>` lock: a `Sheet` is held still
  // by CSS, so nothing else exercises it.
  it("locks the page's scroll while open, and releases it on close", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(modalIsOpen()).toBe(false);
  });

  // Browse is the current screen, so the pathname does not change.
  it("closes on arriving, even where it was already", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Browse" }));

    expect(modalIsOpen()).toBe(false);
  });

  // Closing unmounts nothing, so focus would otherwise stay in a hidden panel.
  it("hands focus back to the hamburger", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(trigger()).toHaveFocus();
  });

  // The suite-wide `matchMedia` stub never changes and registers no listeners,
  // so this installs one that can cross the breakpoint.
  it("stops being open once the window is too wide for it", async () => {
    const user = userEvent.setup();
    const crossInto = stubBreakpoint();
    renderShell();

    await user.click(trigger());
    expect(modalIsOpen()).toBe(true);

    crossInto(true);

    expect(modalIsOpen()).toBe(false);
    // Kept, the lock would freeze a desk's page with no modal on it.
    expect(document.body.style.overflow).toBe("");
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
