import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect } from "storybook/test";

import { SongDetailPage } from "./SongDetailPage";
import type { Song } from "@/lib/types";
import { catalogSongs } from "@/test/catalog";
import {
  API,
  listById,
  makeList,
  makeRecording,
  makeSong,
  makeUser,
  notFound,
} from "@/test/handlers";

/** Answers `/songs/:ref` by slug or id, as the API does. */
function serveSongs(...songs: Song[]) {
  return http.get(`${API}/api/v1/songs/:ref`, ({ params }) => {
    const found = songs.find((song) => song.slug === params.ref || song.id === params.ref);
    return found ? HttpResponse.json(found) : notFound("Song was not found.");
  });
}

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
  genres: catalogSongs[0]?.genres ?? [],
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
    msw.use(serveSongs(makeSong(), documented, ...catalogSongs.slice(1)));
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

/** Read from a list: the bar names the list and the place in it. */
export const InAList: Story = {
  parameters: { route: "/songs/frangosyriani?list=list-1" },
  beforeEach({ msw }) {
    msw.use(
      listById(
        makeList({
          songs: catalogSongs.slice(0, 3).map((song, position) => ({ ...song, position })),
          item_count: 3,
        }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "Ρεμπέτικα" })).toBeVisible();
    await expect(canvas.getByText("2 of 3")).toBeVisible();
  },
};

/** An admin can edit and delete any song; the page offers both. */
export const AsAdmin: Story = {
  parameters: { user: makeUser({ role: "admin" }) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: /edit/i })).toBeVisible();
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

export const NotFound: Story = {
  parameters: { route: "/songs/no-such-song" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Song was not found.");
  },
};
