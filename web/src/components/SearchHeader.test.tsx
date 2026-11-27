import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { SearchHeader } from "./SearchHeader";

// jsdom lays nothing out, so boxes are asserted through their classes.
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

  // `min-w-0`: an input will not shrink below its intrinsic width without it,
  // which overflows the row on narrow phones.
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
});
