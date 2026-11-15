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
    }),
  },
  play: async ({ canvas }) => {
    // Performers from the first recording lead the byline, then the composer.
    await expect(canvas.getByText("Γιώργος Νταλάρας · Μίκης Θεοδωράκης")).toBeVisible();
    await expect(canvas.getByRole("img", { name: "Has a video" })).toBeVisible();
    await expect(canvas.getByText("θάλασσας").tagName).toBe("MARK");
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

/** Cards stay level: an empty byline and genre row keep their height. */
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
