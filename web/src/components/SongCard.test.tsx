import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SongCard } from "./SongCard";
import { makeGenre, makeSong } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * The card's reserved slots, which are what keep a list's rows in step. jsdom
 * computes no layout, so each is pinned by the thing that holds it open.
 */
describe("SongCard", () => {
  // The one paragraph is the subtitle because the fixture carries no snippet —
  // `Snippet` renders a <p> of its own.
  it("keeps the subtitle's line on a song with nobody credited", () => {
    renderWithProviders(<SongCard song={makeSong({ credits: [] })} />);

    expect(screen.getByRole("paragraph")).toHaveClass("min-h-lh");
  });

  // Compared against a real chip rather than measured against a size named
  // here: what the empty row has to hold is a chip's own box, and the classes
  // the two share are as near as jsdom gets to saying so. The space inside the
  // placeholder is pinned for the same reason it is there — without it the row
  // is its padding and nothing else, which no other assertion here would show.
  it("holds the genre row open with a chip's box when a song has none", () => {
    const withGenre = renderWithProviders(<SongCard song={makeSong({ genres: [makeGenre()] })} />);
    const chip = screen.getByText("Ρεμπέτικο");

    // A placeholder left in beside real chips would take a chip's width and the
    // gap after it, crowding the row towards a second line it does not need.
    expect(withGenre.container.querySelector(".invisible")).toBeNull();

    const { container } = renderWithProviders(<SongCard song={makeSong({ genres: [] })} />);
    const placeholder = container.querySelector(".invisible");

    expect(placeholder).toHaveClass(`${chip.className} invisible`, { exact: true });
    expect(placeholder?.textContent).toBe("\u00A0");
  });
});
