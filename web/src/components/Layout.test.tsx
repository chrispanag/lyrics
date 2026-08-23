import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { Layout, StickyHeader } from "./Layout";
import { makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { scrollDown, scrollUp, setScrollY } from "@/test/scroll";

/*
 * Which of the two navigations holds the way to the profile, and — in the
 * sidebar — whether it holds one at all. Why each does is on `identityCard` in
 * Layout.tsx.
 *
 * Both navigations are asserted because jsdom has no breakpoints: the sidebar
 * and the tab bar are in the document at once, so which one holds the link is
 * the only readable form of which reader is served. The bar is asked of a
 * guest, signing in being what that route buys a phone; the sidebar is asked
 * twice, since the card only stands in for the entry while there is a card, and
 * a guest at a desk has none.
 */
describe("Layout navigation", () => {
  /*
   * The two navigations, reached by the landmarks that tell them apart.
   *
   * Only ever one of them is on screen — `hidden md:flex` against `md:hidden` —
   * so the sidebar's own `<nav>` is deliberately unnamed, and the `<aside>`
   * around it is what there is to ask for. Naming that nav to make this pair
   * symmetric would be markup added for the test.
   */
  const sidebar = () => screen.getByRole("complementary");
  const tabBar = () => screen.getByRole("navigation", { name: "Main" });

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
  const sidebarRoutesToProfile = () =>
    within(within(sidebar()).getByRole("navigation"))
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/profile");

  it("reaches the profile from the identity card rather than a sidebar link", () => {
    renderWithProviders(<Layout />, { user: makeUser({ display_name: "Christos" }) });

    expect(sidebarRoutesToProfile()).toHaveLength(1);
    expect(sidebarRoutesToProfile()[0]).toBe(
      within(sidebar()).getByRole("link", { name: /Christos/ }),
    );
  });

  it("keeps the sidebar link for a guest, who has no identity card", () => {
    renderWithProviders(<Layout />, { user: null });

    // The card stands in for the entry only while there is a card, and a guest
    // gets the Sign in button in its place. Filtered out for them too,
    // `/profile` — and the theme switch, which is on no other screen — would be
    // unreachable above `md`, where the tab bar is hidden.
    expect(sidebarRoutesToProfile()).toHaveLength(1);
  });

  it("keeps the profile tab, which is a phone's only way to sign in", () => {
    renderWithProviders(<Layout />, { user: null });

    expect(within(tabBar()).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });
});

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
