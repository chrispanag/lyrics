import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { SongCard } from "./SongCard";
import { makeGenre, makeRecording, makeSong } from "@/test/handlers";

const meta = {
  title: "Catalog/SongCard",
  component: SongCard,
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { song: makeSong() },
} satisfies Meta<typeof SongCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Most of the catalog: a composer, no recordings, no genres. */
export const Minimal: Story = {};

export const Complete: Story = {
  args: {
    song: makeSong({
      // The song's video is the trigger's copy of its first recording's.
      youtube_video_id: "dQw4w9WgXcQ",
      recordings: [makeRecording({ youtube_video_id: "dQw4w9WgXcQ" })],
      genres: [makeGenre(), makeGenre({ id: "genre-2", name: "Λαϊκό", slug: "laiko" })],
      snippet: "Στης ⟦θάλασσας⟧ τα βάθη\nη αγάπη μου κοιμάται",
      popularity: {
        anonymous_clicks: 6,
        authenticated_clicks: 1,
        list_adds: 3,
        list_users: 2,
        score: 29,
      },
    }),
  },
  play: async ({ canvas }) => {
    // The genres lead the line, then the first recording's performers, then
    // the composer.
    await expect(
      canvas.getByText("Ρεμπέτικο · Λαϊκό · Γιώργος Νταλάρας · Μίκης Θεοδωράκης"),
    ).toBeVisible();
    await expect(canvas.getByText("θάλασσας").tagName).toBe("MARK");
    // No badges: a video and the tallies are on the song's page, not the card.
    await expect(canvas.queryByRole("img")).toBeNull();
    await expect(canvas.queryByText("3")).toBeNull();
  },
};

/** A list row keeps `?list=` on the address, or the next song is a dead end. */
export const InAList: Story = {
  args: { listId: "list-1" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link")).toHaveAttribute(
      "href",
      "/songs/thalassa-platia?list=list-1",
    );
  },
};

/**
 * A line too long for the row is cut once, at its end: the genre leads and
 * stays in sight, and the names give way.
 */
export const LongByline: Story = {
  args: {
    song: makeSong({
      credits: [
        { person_id: "person-1", name: "Μίκης Θεοδωράκης", role: "composer", position: 0 },
        { person_id: "person-2", name: "Ιάκωβος Καμπανέλλης", role: "lyricist", position: 0 },
      ],
      recordings: [makeRecording()],
      genres: [makeGenre()],
    }),
  },
  decorators: [
    (Story) => (
      <div className="w-[270px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    const line = canvas.getByText(/^Ρεμπέτικο · Γιώργος Νταλάρας/);
    // Cut short, by the line's own ellipsis.
    await expect(line.scrollWidth).toBeGreaterThan(line.clientWidth);
    await expect(getComputedStyle(line).textOverflow).toBe("ellipsis");
    // One box holding one string, so there is one ellipsis and it ends the
    // line: no second truncated piece whose separator could sit beside it.
    await expect(line.children).toHaveLength(0);
    await expect(line.textContent).not.toMatch(/·\s*·/);
    // The genre is before the cut, whole.
    const genre = document.createRange();
    genre.selectNodeContents(line);
    genre.setEnd(line.firstChild ?? line, "Ρεμπέτικο".length);
    await expect(genre.getBoundingClientRect().right).toBeLessThan(
      line.getBoundingClientRect().right,
    );
  },
};

/** Rows stay level: an empty names line keeps its height. */
export const Level: Story = {
  render: () => (
    <div className="grid grid-cols-2 items-start gap-3">
      <SongCard song={makeSong({ credits: [] })} />
      <SongCard song={makeSong({ id: "song-2", genres: [makeGenre()] })} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [first, second] = canvasElement.querySelectorAll("a");
    await expect(first?.getBoundingClientRect().height).toBe(
      second?.getBoundingClientRect().height,
    );
  },
};
