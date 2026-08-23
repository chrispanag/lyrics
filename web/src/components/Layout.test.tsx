import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Layout, StickyHeader } from "./Layout";
import { MenuHeader } from "./SearchHeader";
import { modalIsOpen } from "@/lib/modal";
import { makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { scrollDown, scrollUp, setScrollY } from "@/test/scroll";

/*
 * Which of the two navigations holds the way to the profile, and whether it
 * holds one at all. Why either does is on `identityCard` in Layout.tsx.
 *
 * Both are asserted because jsdom has no breakpoints: the sidebar and the phone's
 * drawer are in the document at once, so which one holds the link is the only
 * readable form of which reader is served. Each is asked twice, since the card
 * only stands in for the entry while there is a card, and a guest has none.
 */
describe("Layout navigation", () => {
  /*
   * The two navigations, reached by what tells them apart.
   *
   * Only ever one of them is on screen — `hidden md:flex` against `md:hidden` —
   * so the sidebar's own `<nav>` is deliberately unnamed, and the `<aside>`
   * around it is what there is to ask for. The drawer is asked for by its label,
   * which it carries whether or not it is open: its `role="dialog"` deliberately
   * does not, and asking by role would leave the closed drawer — the state the
   * spec below is about — unreachable.
   */
  const sidebar = () => screen.getByRole("complementary");
  const drawer = () => screen.getByLabelText("Navigation");

  /*
   * Asked of the destination rather than of the label the entry carried:
   * renamed rather than removed, a second route to the profile would sit above
   * the card with every assertion about "Profile" still passing.
   *
   * Asked inside the sidebar's `<nav>` rather than anywhere in the `<aside>`,
   * which is what pins the card as part of the navigation: rendered beside the
   * landmark instead of within it, the card still works for everyone who can see
   * it and leaves a reader navigating by landmark no route to their own profile.
   */
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

    // The card stands in for the entry only while there is a card, and a guest
    // gets the Sign in button in its place. Filtered out for them too,
    // `/profile` — and the theme switch, which is on no other screen — would be
    // unreachable, and with it a second way to sign in.
    expect(routesToProfile(sidebar())).toHaveLength(1);
    expect(routesToProfile(drawer())).toHaveLength(1);
  });

  it("offers a guest the way in from either navigation", () => {
    renderWithProviders(<Layout />, { user: null });

    // The tab bar this drawer replaced had no Sign in button, which is why the
    // profile entry had to be there whatever the reader was. Both surfaces
    // render one panel now, so both have it — and this is what says so.
    expect(within(sidebar()).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(within(drawer()).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});

/*
 * The drawer's own behavior: what it is while closed, and what opens and closes
 * it.
 *
 * It is mounted the whole time so that it can slide, which is what makes the
 * first spec here the load-bearing one — see `MobileNavDrawer`.
 */
describe("Mobile navigation drawer", () => {
  /**
   * The shell with something in it that renders the trigger, which the shell
   * itself deliberately does not: on a phone the header a page already carries
   * is the only row the hamburger can go in without costing the vertical space
   * the drawer was built to reclaim.
   */
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

  /*
   * A closed drawer must not look like an open modal.
   *
   * `lib/modal.ts` asks the DOM for `[role="dialog"][aria-modal="true"]` and
   * never for anything visible, and both the song page's paging swipe and its
   * arrow keys stand down whenever it answers yes. A drawer that carried the
   * pair while closed would carry it for the whole session: the gestures die on
   * every phone, silently, and nothing about the drawer looks wrong.
   */
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

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(modalIsOpen()).toBe(false);
  });

  // Keyed on the location rather than its pathname, which is why Browse — the
  // screen this spec is already on — is the one worth pressing: the path does
  // not change, so a drawer watching only that is left standing open with
  // nothing having happened.
  it("closes on arriving, even where it was already", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Browse" }));

    expect(modalIsOpen()).toBe(false);
  });

  // Closing unmounts nothing, so focus is not dropped the way `Sheet` describes
  // — but it is inside a panel the reader can no longer see, which is the same
  // dead end by another route.
  it("hands focus back to the hamburger", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(trigger()).toHaveFocus();
  });

  /*
   * A window that grows past `md` takes the drawer and its hamburger away
   * together — and an open drawer nobody can see still costs everything an open
   * modal costs. `modalIsOpen()` reads the marking off the DOM and never asks
   * what is visible, so the song page's paging swipe and its arrow keys would
   * stand down for the rest of the session, with the scroll lock freezing a
   * desk's page behind them. One rotation of a phone is all it takes: landscape
   * is 812px or more.
   *
   * The suite-wide `matchMedia` stub answers `false` forever and registers no
   * listeners, which is exactly what a spec about crossing the breakpoint cannot
   * use — so this installs one that can be moved, and puts the old one back.
   */
  it("stops being open once the window is too wide for it", async () => {
    const user = userEvent.setup();
    const crossInto = stubBreakpoint();
    renderShell();

    await user.click(trigger());
    expect(modalIsOpen()).toBe(true);

    crossInto(true);

    expect(modalIsOpen()).toBe(false);
  });
});

/**
 * A `window.matchMedia` whose answer can be changed, returning the function that
 * changes it. Restored by the `afterEach` below, so the suite-wide stub is back
 * in place for every other spec in this file.
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
 * The header both the catalog and a song page put their search box in.
 *
 * Its rule is a class, and jsdom has no breakpoints — so which class it carries
 * is the only readable form of "out of the way on a phone, sticky at a desk".
 * Pinned here rather than through either page: the rule belongs to the component
 * they share, and read through one page's render the other page's behavior rides
 * on a spec that has nothing to do with it. Dropping the `max-md:` prefix would
 * make the desktop header slide away on both.
 */
describe("StickyHeader", () => {
  beforeEach(() => setScrollY(0));

  /**
   * The header itself: inside the app's `<main>` it is no banner to query by role.
   *
   * Asserted against with `toHaveClass` rather than by searching the class string,
   * so the two negative specs below cannot pass on an element that was never
   * found — `expect(undefined).not.toContain(…)` is true of nothing at all. It
   * also matches whole class names, which is what lets the unprefixed transform be
   * ruled out separately from the `max-md:` one.
   */
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

  // What needs this is a header with something hanging off it — the song page's
  // results are anchored to that box, so a header that slid away would take them
  // with it.
  it("stays put while it is pinned", () => {
    render(<StickyHeader pinned>Search</StickyHeader>);

    scrollDown();

    expect(header()).not.toHaveClass("max-md:-translate-y-full");
  });
});
