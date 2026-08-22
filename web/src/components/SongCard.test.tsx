import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SongCard } from "./SongCard";
import { makeGenre, makeSong } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * A card's height must not depend on what its song happens to carry: one short
 * card leaves every row under it out of step with the others. jsdom computes no
 * layout, so each reservation is pinned by the thing that holds it open — a
 * class on the subtitle, an invisible chip in the genre row.
 */
describe("SongCard", () => {
  // The one paragraph is the subtitle because the fixture carries no snippet —
  // `Snippet` renders a <p> of its own.
  it("keeps the subtitle's line on a song with nobody credited", () => {
    renderWithProviders(<SongCard song={makeSong({ credits: [] })} />);

    expect(screen.getByRole("paragraph")).toHaveClass("min-h-lh");
  });

  // Queried through the DOM rather than by role: the row is a plain box and its
  // placeholder is hidden from assistive tech on purpose, so no accessible
  // query can reach either.
  it("keeps the genre row on a song with no genres", () => {
    const { container } = renderWithProviders(<SongCard song={makeSong({ genres: [] })} />);

    const chips = container.querySelectorAll("span.rounded-full");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveClass("invisible");
    expect(chips[0]).toHaveAttribute("aria-hidden", "true");
  });

  // The other half of the same rule: a placeholder left in beside real chips
  // would pay for the row twice, in the gap between it and the first genre.
  it("shows a song's genres without a placeholder beside them", () => {
    const { container } = renderWithProviders(
      <SongCard song={makeSong({ genres: [makeGenre()] })} />,
    );

    expect(screen.getByText("Ρεμπέτικο")).toBeInTheDocument();
    expect(container.querySelectorAll("span.rounded-full")).toHaveLength(1);
    expect(container.querySelector(".invisible")).toBeNull();
  });
});
