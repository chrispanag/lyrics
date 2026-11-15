import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SongCard } from "./SongCard";
import { makeGenre, makeRecording, makeSong } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

// jsdom computes no layout, so reserved slots are pinned by what holds them open.
describe("SongCard", () => {
  // The only paragraph, since the fixture has no snippet (which is also a <p>).
  it("keeps the subtitle's line on a song with nobody credited", () => {
    renderWithProviders(<SongCard song={makeSong({ credits: [] })} />);

    expect(screen.getByRole("paragraph")).toHaveClass("min-h-lh");
  });

  // Performers come from a different field than the credits, so a regression
  // would drop them silently.
  it("names the first recording's performers ahead of the credits", () => {
    renderWithProviders(<SongCard song={makeSong({ recordings: [makeRecording()] })} />);

    expect(screen.getByText("Γιώργος Νταλάρας · Μίκης Θεοδωράκης")).toBeInTheDocument();
  });

  // The pairing a per-field dedupe would miss.
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

  it("falls back to the credits when a song has no recordings", () => {
    renderWithProviders(<SongCard song={makeSong()} />);

    expect(screen.getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
  });

  // Read off the id, as the song page's watch link is, so the two agree.
  it("badges a song with a video, and only one", () => {
    const { unmount } = renderWithProviders(
      <SongCard song={makeSong({ youtube_video_id: "dQw4w9WgXcQ" })} />,
    );
    expect(screen.getByRole("img", { name: "Has a video" })).toBeInTheDocument();
    unmount();

    renderWithProviders(<SongCard song={makeSong()} />);
    expect(screen.queryByRole("img", { name: "Has a video" })).toBeNull();
  });

  // Compared against a real chip's classes, the nearest jsdom gets to its box.
  it("holds the genre row open with a chip's box when a song has none", () => {
    const genre = makeGenre();
    const withGenre = renderWithProviders(<SongCard song={makeSong({ genres: [genre] })} />);
    const chip = screen.getByText(genre.name);

    // No placeholder beside real chips.
    expect(withGenre.container.querySelector(".invisible")).toBeNull();

    const { container } = renderWithProviders(<SongCard song={makeSong({ genres: [] })} />);
    const placeholder = container.querySelector(".invisible");

    expect(placeholder).toHaveClass(`${chip.className} invisible`, { exact: true });
    expect(placeholder?.textContent).toBe("\u00A0");
  });
});
