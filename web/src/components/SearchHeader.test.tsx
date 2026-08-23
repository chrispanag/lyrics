import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { SearchHeader } from "./SearchHeader";

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

    expect(row().childElementCount).toBe(1);
    expect(box()).toHaveClass("min-w-0", "flex-1");
  });

  it("gives a control beside the field a place of its own in the same row", () => {
    render(header(<button type="button">Filters</button>));

    expect(row().childElementCount).toBe(2);
    expect(box()).toHaveClass("min-w-0", "flex-1");
    expect(screen.getByRole("button", { name: "Filters" }).parentElement).toHaveClass("shrink-0");
  });
});
