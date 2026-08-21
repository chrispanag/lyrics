import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SongCard } from "./SongCard";
import { makeSong } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

describe("SongCard", () => {
  // A card's height must not depend on its song having credits: one short card
  // leaves every row under it out of step with the others. jsdom computes no
  // layout, so the reserved line is pinned by the class that holds it open.
  //
  // The one paragraph is the subtitle because the fixture carries no snippet —
  // `Snippet` renders a <p> of its own.
  it("keeps the subtitle's line on a song with nobody credited", () => {
    renderWithProviders(<SongCard song={makeSong({ credits: [] })} />);

    expect(screen.getByRole("paragraph")).toHaveClass("min-h-lh");
  });
});
