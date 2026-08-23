import type { Song, SongList } from "@/lib/types";

/*
 * Reading a song from inside a list.
 *
 * Which list a song is being read from lives in its URL, like every other bit of
 * state that shapes what is on screen: the context then survives a reload,
 * travels in a shared link, and is restored by the back button — none of which
 * router state, which exists only in the tab that set it, can do.
 *
 * Every destination is built here. A step through a list is an address and
 * nothing else, so nothing downstream has to remember to put the list back into
 * the URL — which is the one mistake that turns the next song into a dead end,
 * silently, since the page renders perfectly and the reader is merely out of the
 * list.
 */

/** The query parameter naming the list a song is being read from. */
export const LIST_PARAM = "list";

/**
 * A song's URL, carrying the list it is being read from if there is one.
 *
 * Takes the song rather than an identifier, so no call site has to know which of
 * its two identifiers is the address. The slug is; the id is what every link
 * written before slugs existed says, and the API still answers both — but a link
 * built here is a new one and should be the readable form.
 */
export function songHref(song: Pick<Song, "slug">, listId?: string): string {
  const path = `/songs/${song.slug}`;
  return listId ? `${path}?${LIST_PARAM}=${encodeURIComponent(listId)}` : path;
}

/**
 * A song's URL when all that is in hand is what a route parameter held.
 *
 * The two pages that render before their song has arrived are what need it: the
 * editor may have to leave before it has one, and the song page draws its Edit
 * link over the shell. The address they came in on is a perfectly good
 * destination whichever of the two forms it holds. It goes through `songHref`
 * rather than building a path, so `/songs/` stays written once.
 */
export function songRefHref(ref: string): string {
  return songHref({ slug: ref });
}

/**
 * The song a `/songs/…` address names, or null for any other address.
 *
 * The other direction of `songHref`, and here so that the module owning the
 * shape owns both: read off a pathname anywhere else, `/songs/` would be
 * written in two places and only one of them would be found when it changed.
 */
export function songRefFromPath(pathname: string): string | null {
  return /^\/songs\/([^/]+)$/.exec(pathname)?.[1] ?? null;
}

/**
 * Whether a route parameter names this song.
 *
 * It has to accept both forms, and permanently: a `/songs/<uuid>?list=<id>`
 * link shared before slugs existed still resolves — the API answers either — and
 * nothing canonicalizes it on the way in. Ask about the slug alone and every
 * reader holding an old link gets a song page with no list bar, no swipe and no
 * arrow keys, with nothing on screen saying why.
 */
export function songMatchesRef(song: Pick<Song, "id" | "slug">, ref: string): boolean {
  return song.slug === ref || song.id === ref;
}

/** Where a song sits in a list, and the addresses on either side of it. */
export interface ListPosition {
  listName: string;
  listHref: string;
  /** Zero-based, so what a reader is shown is `index + 1`. */
  index: number;
  total: number;
  /** Absent on the first song of the list, which is what draws the dead arrow. */
  previousHref?: string;
  /** Absent on the last one, for the same reason. */
  nextHref?: string;
}

/**
 * Locates a song in a list, as the addresses around it.
 *
 * Null when the song is not among the list's own, which is every way the pairing
 * can be wrong at once: a song taken out of the list in another tab, a parameter
 * typed by hand, a list whose songs never arrived because the reader may not see
 * it. All of them leave the page with no navigation rather than an error nobody
 * asked for — the song itself is what was requested, and it is there.
 */
export function listPosition(list: SongList, ref: string): ListPosition | null {
  // `songs` carries `omitempty` on the Go side, so an empty list arrives with
  // the key absent rather than as [].
  const songs = list.songs ?? [];
  const index = songs.findIndex((song) => songMatchesRef(song, ref));
  if (index < 0) return null;

  const href = (song: Song | undefined) => (song ? songHref(song, list.id) : undefined);

  return {
    listName: list.name,
    listHref: `/lists/${list.id}`,
    index,
    total: songs.length,
    previousHref: href(songs[index - 1]),
    nextHref: href(songs[index + 1]),
  };
}
