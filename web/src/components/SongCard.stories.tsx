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
    // Performers from the first recording lead the byline, then the composer.
    await expect(canvas.getByText("Γιώργος Νταλάρας · Μίκης Θεοδωράκης")).toBeVisible();
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

/** The song the address has open: an accent fill, and no border. */
export const Current: Story = {
  parameters: { route: "/songs/thalassa-platia" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link")).toHaveAttribute("aria-current", "page");
  },
};

/**
 * Rows as a list stacks them: the years in one column down the right, a row
 * without a year leaving its slot empty, and each row as tall as its content.
 */
export const Stacked: Story = {
  render: () => (
    <div className="space-y-1">
      <SongCard song={makeSong({ genres: [makeGenre()] })} />
      <SongCard
        song={makeSong({ id: "song-2", slug: "s2", title: "Άρνηση", release_year: null })}
      />
      <SongCard
        song={makeSong({
          id: "song-3",
          slug: "s3",
          title: "Bare",
          credits: [],
          release_year: 2011,
        })}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const rows = [...canvasElement.querySelectorAll("a")];
    const years = rows.map((row) => row.lastElementChild?.getBoundingClientRect());
    const titles = rows.map((row) => row.querySelector("h2")?.getBoundingClientRect());

    // One column: every year's box shares its edges, the empty one included.
    for (const year of years.slice(1)) {
      await expect(year?.left).toBe(years[0]?.left);
      await expect(year?.right).toBe(years[0]?.right);
    }
    await expect(rows[1]?.lastElementChild?.textContent).toBe("");
    // So every title has the same room.
    await expect(new Set(titles.map((title) => title?.width)).size).toBe(1);
    // Height follows content: genres add a line, and a bare song is one line.
    const heights = rows.map((row) => row.getBoundingClientRect().height);
    await expect(heights[0]).toBeGreaterThan(heights[1] ?? 0);
    await expect(heights[1]).toBeGreaterThan(heights[2] ?? 0);
  },
};
