import { makeGenre, makeList, makeRecording, makeSong } from "./handlers";
import type { Song, SongList } from "@/lib/types";

/*
 * A handful of songs shaped like the real catalog, for stories that show a
 * page of them: mostly Greek, mostly with a year and nobody's name on the
 * recording, a few with performers, a video or genres.
 */

export const rempetiko = makeGenre();
export const laiko = makeGenre({ id: "genre-2", name: "Λαϊκό", slug: "laiko" });
export const entechno = makeGenre({ id: "genre-3", name: "Έντεχνο", slug: "entechno" });

export const catalogGenres = [rempetiko, laiko, entechno];

export const catalogSongs: Song[] = [
  makeSong({
    youtube_video_id: "dQw4w9WgXcQ",
    recordings: [makeRecording({ youtube_video_id: "dQw4w9WgXcQ" })],
    genres: [entechno],
  }),
  makeSong({
    id: "song-2",
    slug: "frangosyriani",
    title: "Φραγκοσυριανή",
    release_year: 1935,
    credits: [{ person_id: "person-3", name: "Μάρκος Βαμβακάρης", role: "composer", position: 0 }],
    recordings: [
      makeRecording({
        release_year: 1935,
        performers: [{ person_id: "person-3", name: "Μάρκος Βαμβακάρης", position: 0 }],
      }),
    ],
    genres: [rempetiko],
  }),
  makeSong({
    id: "song-3",
    slug: "to-vals-ton-chamenon-oneiron",
    title: "Το Βαλς των Χαμένων Ονείρων",
    release_year: 1973,
    credits: [{ person_id: "person-4", name: "Μάνος Λοΐζος", role: "composer", position: 0 }],
    genres: [laiko, entechno],
  }),
  makeSong({
    id: "song-4",
    slug: "yesterday",
    title: "Yesterday",
    language: "en",
    release_year: 1965,
    credits: [
      { person_id: "person-5", name: "Paul McCartney", role: "composer", position: 0 },
      { person_id: "person-5", name: "Paul McCartney", role: "lyricist", position: 1 },
    ],
  }),
  makeSong({ id: "song-5", slug: "choris-stoicheia", title: "Χωρίς Στοιχεία", credits: [] }),
];

/** A list holding the first `count` catalog songs, its count derived from them. */
export function catalogList(count: number, overrides: Partial<SongList> = {}): SongList {
  const songs = catalogSongs.slice(0, count).map((song, position) => ({ ...song, position }));
  return makeList({ songs, item_count: songs.length, ...overrides });
}
