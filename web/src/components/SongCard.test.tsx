import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SongCard } from "./SongCard";
import { makeGenre, makeRecording, makeSong } from "@/test/handlers";
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

  /*
   * The byline: who performed it, then who wrote it.
   *
   * Performers lead because that is the order this line has always had — before
   * recordings they were `artist` credits sorted to the front — and they now
   * come from a different field than the rest of it, which is the part a
   * regression would drop silently.
   */
  it("names the first recording's performers ahead of the credits", () => {
    renderWithProviders(<SongCard song={makeSong({ recordings: [makeRecording()] })} />);

    expect(screen.getByText("Γιώργος Νταλάρας · Μίκης Θεοδωράκης")).toBeInTheDocument();
  });

  // One person who wrote a song and also performed it is one name. Repeating it
  // reads as a mistake rather than as two distinct contributions, and this is
  // the pairing a per-field dedupe would miss.
  it("names someone who both wrote and performed a song once", () => {
    renderWithProviders(
      <SongCard
        song={makeSong({
          credits: [
            { person_id: "person-9", name: "Nick Cave", role: "composer", position: 0 },
          ],
          recordings: [
            makeRecording({
              performers: [{ person_id: "person-9", name: "Nick Cave", position: 0 }],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Nick Cave")).toBeInTheDocument();
  });

  // A song with no recordings still has a byline: its credits alone. Most of
  // the catalog's songs are reachable in this state.
  it("falls back to the credits when a song has no recordings", () => {
    renderWithProviders(<SongCard song={makeSong()} />);

    expect(screen.getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
  });

  // Compared against a real chip rather than measured against a size named
  // here: what the empty row has to hold is a chip's own box, and the classes
  // the two share are as near as jsdom gets to saying so. The space inside the
  // placeholder is pinned for the same reason it is there — without it the row
  // is its padding and nothing else, which no other assertion here would show.
  it("holds the genre row open with a chip's box when a song has none", () => {
    const genre = makeGenre();
    const withGenre = renderWithProviders(<SongCard song={makeSong({ genres: [genre] })} />);
    const chip = screen.getByText(genre.name);

    // A placeholder left in beside real chips would take a chip's width and the
    // gap after it, crowding the row toward a second line it does not need.
    expect(withGenre.container.querySelector(".invisible")).toBeNull();

    const { container } = renderWithProviders(<SongCard song={makeSong({ genres: [] })} />);
    const placeholder = container.querySelector(".invisible");

    expect(placeholder).toHaveClass(`${chip.className} invisible`, { exact: true });
    expect(placeholder?.textContent).toBe("\u00A0");
  });
});
