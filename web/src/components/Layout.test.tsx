import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { StickyHeader } from "./Layout";
import { scrollDown, scrollUp, setScrollY } from "@/test/scroll";

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
