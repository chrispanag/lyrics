import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { MenuHeader, SearchHeader } from "./SearchHeader";

/*
 * The header the catalog's search box and a song page's share.
 *
 * jsdom lays nothing out, so a box is only readable as the classes that give it
 * one — the same bargain `StickyHeader`'s specs make next door. What is worth
 * reading here is the half of the rule that is a choice rather than a structure:
 * the field takes the whole row when nothing sits beside it, instead of a slot
 * being held empty. (The other half needs no spec: one component renders the
 * column, so no page has one to disagree about.)
 */
describe("SearchHeader", () => {
  const field = () => screen.getByLabelText("Search songs");
  /** The box the row gives the field, which is the component's to size. */
  const box = () => field().parentElement!;
  const row = () => box().parentElement!;

  const header = (trailing?: ReactNode) => (
    <SearchHeader trailing={trailing}>
      <input aria-label="Search songs" />
    </SearchHeader>
  );

  // An empty slot held the field a half-button left of center on every page with
  // nothing to put in it — and the row's `gap` would cost 8px of the field even
  // with nothing rendered inside that slot at all.
  //
  // `min-w-0` is asserted beside `flex-1` in both specs because an input does not
  // shrink below its intrinsic width on its own: without it the row is wider than
  // a narrow phone's column, which overflows the field on the page with nothing
  // beside it and pushes the control out of it on the page that has one. Only on
  // the narrowest screens, so nothing at a desk says it went.
  it("leaves the field the whole row when nothing sits beside it", () => {
    render(header());

    expect(row().lastElementChild).toBe(box());
    expect(box()).toHaveClass("min-w-0", "flex-1");
  });

  it("gives a control beside the field a place of its own in the same row", () => {
    render(header(<button type="button">Filters</button>));

    expect(row().lastElementChild).not.toBe(box());
    expect(box()).toHaveClass("min-w-0", "flex-1");
    expect(screen.getByRole("button", { name: "Filters" }).parentElement).toHaveClass("shrink-0");
  });

  /*
   * The hamburger is the component's own rather than something a page hands it,
   * which is the same rule as the column one level in: passed by the caller, the
   * field would start 52px further left on the page that forgot, and the box a
   * reader just tapped through would move under their finger. Asserted as the
   * row's *first* child, since where it sits is the whole of what makes the
   * field's left edge the same on every screen.
   */
  it("leads the row with the drawer's trigger, on any page that renders it", () => {
    render(header(<button type="button">Filters</button>));

    expect(row().firstElementChild).toBe(screen.getByRole("button", { name: "Open menu" }));
  });
});

/*
 * The same bar for a screen with no search box, which is every screen but two.
 *
 * What it has to hold is the trigger, in the column the other one uses — a bar
 * that placed it anywhere else would move the hamburger between a song page and
 * the list it was opened from.
 *
 * Asserted as the two columns being the *same string* rather than against the
 * classes written out here: hard-coded, this spec pins a copy staying in sync,
 * which is the weaker guarantee the component exists not to rely on. Compared,
 * it fails the moment the two stop sharing one.
 */
describe("MenuHeader", () => {
  // The column is the header's own child in both, which is what makes them
  // comparable — the search bar puts a flex row between it and the button and
  // the menu bar has no row at all.
  const columnOf = (ui: ReactNode) => {
    const { unmount } = render(ui);
    const header = screen.getByRole("button", { name: "Open menu" }).closest("header")!;
    const column = header.firstElementChild!.className;
    unmount();
    return column;
  };

  it("carries the same trigger in the same column as the search bar", () => {
    expect(columnOf(<MenuHeader />)).toBe(
      columnOf(
        <SearchHeader>
          <input aria-label="Search songs" />
        </SearchHeader>,
      ),
    );
  });
});
