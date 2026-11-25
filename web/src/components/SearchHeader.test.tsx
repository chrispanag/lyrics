import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { MenuHeader, SearchHeader } from "./SearchHeader";

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

  // First child, so the field's left edge is the same on every screen.
  it("leads the row with the menu button, on any page that renders it", () => {
    render(header(<button type="button">Filters</button>));

    expect(row().firstElementChild).toBe(screen.getByRole("button", { name: "Open menu" }));
  });
});

// Compares the two columns with each other rather than with hard-coded classes,
// which would only pin a copy staying in sync.
describe("MenuHeader", () => {
  // The column is the header's first child in both bars.
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
