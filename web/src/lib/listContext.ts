import type { Song, SongList } from "@/lib/types";

/*
 * Reading a song from inside a list.
 *
 * Which list a song is being read from lives in its URL, like every other bit of
 * state that shapes what is on screen: the context then survives a reload,
 * travels in a shared link, and is restored by the back button — none of which
 * router state, which exists only in the tab that set it, can do.
 *
 * Every destination is built here. A step through a list carries the address it
 * leads to rather than the song it leads to, so nothing downstream has to
 * remember to put the list back into the URL — which is the one mistake that
 * turns the next song into a dead end, silently, since the page renders
 * perfectly and the reader is merely out of the list.
 */

/** The query parameter naming the list a song is being read from. */
export const LIST_PARAM = "list";

/** A song's URL, carrying the list it is being read from if there is one. */
export function songHref(songId: string, listId?: string): string {
  const path = `/songs/${songId}`;
  return listId ? `${path}?${LIST_PARAM}=${encodeURIComponent(listId)}` : path;
}

/** One step through a list: what is there, and where it is. */
export interface ListStep {
  title: string;
  href: string;
}

/** Where a song sits in a list, and the steps on either side of it. */
export interface ListPosition {
  listName: string;
  listHref: string;
  /** Zero-based, so what a reader is shown is `index + 1`. */
  index: number;
  total: number;
  previous?: ListStep;
  next?: ListStep;
}

/**
 * Locates a song in a list, as the steps around it.
 *
 * Null when the song is not among the list's own, which is every way the pairing
 * can be wrong at once: a song taken out of the list in another tab, a parameter
 * typed by hand, a list whose songs never arrived because the reader may not see
 * it. All of them leave the page with no navigation rather than an error nobody
 * asked for — the song itself is what was requested, and it is there.
 */
export function listPosition(list: SongList, songId: string): ListPosition | null {
  // `songs` carries `omitempty` on the Go side, so an empty list arrives with
  // the key absent rather than as [].
  const songs = list.songs ?? [];
  const index = songs.findIndex((song) => song.id === songId);
  if (index < 0) return null;

  const step = (song: Song | undefined): ListStep | undefined =>
    song ? { title: song.title, href: songHref(song.id, list.id) } : undefined;

  return {
    listName: list.name,
    listHref: `/lists/${list.id}`,
    index,
    total: songs.length,
    previous: step(songs[index - 1]),
    next: step(songs[index + 1]),
  };
}
