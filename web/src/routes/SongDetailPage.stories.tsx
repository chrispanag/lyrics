import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import { SongDetailPage } from "./SongDetailPage";
import { catalogList, catalogSongs, entechno } from "@/test/catalog";
import { listById, makeRecording, makeSong, makeUser, songByRef } from "@/test/handlers";

const documented = makeSong({
  id: "song-9",
  slug: "to-palio-roloi",
  title: "Το Παλιό Ρολόι",
  lyrics:
    "Το παλιό ρολόι χτυπά\nμεσάνυχτα στην κάμαρά μου\nκι εσύ δεν είσαι πια εδώ\nνα μου κρατάς τα χέρια μου\n\nΤο παλιό ρολόι χτυπά\nκαι μετρά τα βάσανά μου",
  credits: [
    { person_id: "person-1", name: "Μίκης Θεοδωράκης", role: "composer", position: 0 },
    { person_id: "person-6", name: "Νίκος Γκάτσος", role: "lyricist", position: 1 },
  ],
  youtube_video_id: "dQw4w9WgXcQ",
  release_year: 1962,
  recordings: [
    makeRecording({
      youtube_video_id: "dQw4w9WgXcQ",
      release_year: 1962,
      label: "Columbia",
    }),
    makeRecording({
      id: "recording-2",
      is_first: false,
      position: 1,
      release_year: 1985,
      performers: [{ person_id: "person-7", name: "Χάρις Αλεξίου", position: 0 }],
    }),
  ],
  genres: [entechno],
});

/*
 * The page is mounted under `/songs/:id`, as in the app. Each story waits for
 * the song in `play`, so the axe check sees the page and not the skeleton.
 */
const meta = {
  title: "Pages/Song",
  component: SongDetailPage,
  parameters: { layout: "fullscreen", path: "/songs/:id", route: "/songs/thalassa-platia" },
  beforeEach({ msw }) {
    msw.use(songByRef(makeSong(), documented, ...catalogSongs.slice(1)));
  },
} satisfies Meta<typeof SongDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Most of the catalog: a composer, a year, no recording with anyone's name. */
export const Minimal: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeVisible();
    await expect(canvas.queryByText(/Performed by/)).toBeNull();
  },
};

export const Documented: Story = {
  parameters: { route: "/songs/to-palio-roloi" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Το Παλιό Ρολόι" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: /watch on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  },
};

/**
 * Copied lyrics keep their lines and the gap between verses: each line is its
 * own block, and only a real break survives a selection.
 */
export const CopiesVerseByVerse: Story = {
  parameters: { route: "/songs/to-palio-roloi" },
  play: async ({ canvas }) => {
    // The refrain opens both verses; the first one is in the paragraph either way.
    const [first] = await canvas.findAllByText("Το παλιό ρολόι χτυπά", { selector: "span" });
    const lyrics = first?.parentElement;
    if (!lyrics) throw new Error("No lyrics paragraph");
    const selection = window.getSelection();
    selection?.selectAllChildren(lyrics);
    await expect(selection?.toString().trim()).toBe(documented.lyrics);
    selection?.removeAllRanges();
  },
};

/** Read from a list: the bar names the list and the place in it. */
export const InAList: Story = {
  parameters: { route: "/songs/frangosyriani?list=list-1" },
  beforeEach({ msw }) {
    msw.use(listById(catalogList(3)));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "Ρεμπέτικα" })).toBeVisible();
    await expect(canvas.getByText("2 of 3")).toBeVisible();
  },
};

/**
 * An admin can edit and delete any song; the page offers both, Delete behind
 * "More actions", left open so the axe check sees the menu.
 */
export const AsAdmin: Story = {
  parameters: { user: makeUser({ role: "admin" }) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: /edit/i })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "More actions" }));
    await expect(canvas.getByRole("menuitem", { name: "Delete song" })).toBeVisible();
  },
};

/** The song's own language is marked, so a screen reader voices it correctly. */
export const English: Story = {
  parameters: { route: "/songs/yesterday" },
  play: async ({ canvas }) => {
    const title = await canvas.findByRole("heading", { name: "Yesterday" });
    await expect(title.closest("[lang]")).toHaveAttribute("lang", "en");
  },
};

const longLine = makeSong({
  id: "song-10",
  slug: "makria-grammi",
  title: "Μακριά γραμμή",
  lyrics: "Κι αν η νύχτα πέσει βαριά πάνω στα σπίτια και στα στενά της γειτονιάς μας\nάλλος στίχος",
});

/**
 * A phone's width: a line too long to fit wraps, and its remainder starts
 * further in than the line did, so it never reads as the next line.
 */
export const WrappedLineOnAPhone: Story = {
  parameters: { route: "/songs/makria-grammi" },
  beforeEach({ msw }) {
    msw.use(songByRef(longLine));
  },
  decorators: [
    (Story) => (
      <div className="w-[390px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    const line = await canvas.findByText(/Κι αν η νύχτα πέσει βαριά/);
    const range = document.createRange();
    range.selectNodeContents(line);
    const rows = [...range.getClientRects()];
    // Wrapped, so the check below has a continuation to measure.
    await expect(new Set(rows.map((row) => Math.round(row.top))).size).toBeGreaterThan(1);
    const [start, ...continuations] = rows.map((row) => row.left);
    await expect(Math.max(...continuations)).toBeGreaterThan((start ?? 0) + 4);
  },
};

export const NotFound: Story = {
  parameters: { route: "/songs/no-such-song" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Song was not found.");
  },
};
