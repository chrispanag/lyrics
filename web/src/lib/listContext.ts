import type { Song, SongList } from "@/lib/types";

/*
 * Song addresses, and reading a song from inside a list.
 *
 * The list lives in the URL (`?list=`), not router state, so it survives a
 * reload, a shared link and Back. Every destination is built here: dropping the
 * parameter anywhere silently takes the reader out of the list.
 */

/** The query parameter naming the list a song is being read from. */
export const LIST_PARAM = "list";

/**
 * A song's URL, carrying the list it is being read from if there is one. Takes
 * the song so no call site has to know the slug is the address.
 *
 * `catalogSearch` is the catalog's filters as a query string, kept so the list
 * beside the lyrics is the one the song was opened from.
 */
export function songHref(
  song: Pick<Song, "slug">,
  listId?: string,
  catalogSearch?: string,
): string {
  const path = `/songs/${song.slug}`;
  const params = new URLSearchParams(catalogSearch);
  if (listId) params.set(LIST_PARAM, listId);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * A list's URL: written once, since the sitemap and the canonical name it too
 * and nothing in the app would show the copies drifting apart.
 */
export function listHref(id: string): string {
  return `/lists/${id}`;
}

/**
 * A song's URL when all that is in hand is what a route parameter held, for
 * pages that render before their song arrives. Either form is a valid address.
 */
export function songRefHref(ref: string): string {
  return songHref({ slug: ref });
}

/**
 * The song a `/songs/…` address names, or null for any other address. The
 * inverse of `songHref`; parse paths here, not elsewhere.
 */
export function songRefFromPath(pathname: string): string | null {
  return /^\/songs\/([^/]+)$/.exec(pathname)?.[1] ?? null;
}

/**
 * The list a `/lists/…` address names, or null for any other address. The
 * inverse of `listHref`.
 */
export function listRefFromPath(pathname: string): string | null {
  return /^\/lists\/([^/]+)$/.exec(pathname)?.[1] ?? null;
}

/**
 * The list the reader is in at an address: the list's own page, or the list a
 * song is being read from. Null anywhere else, a song read from no list
 * included. The list pane, the slot beside a song and the navigation all ask
 * this, so they cannot disagree about whether the reader is in a list.
 */
export function listInView(
  pathname: string,
  searchParams: Pick<URLSearchParams, "get">,
): string | null {
  if (songRefFromPath(pathname) !== null) return searchParams.get(LIST_PARAM) || null;
  return listRefFromPath(pathname);
}

/**
 * Whether a route parameter names this song, by slug or id. Both forms,
 * permanently: the server's 308 does not cover every load, and matching the slug
 * alone silently drops the list bar, swipe and arrow keys on an id address.
 */
export function songMatchesRef(song: Pick<Song, "id" | "slug">, ref: string): boolean {
  return song.slug === ref || song.id === ref;
}

/**
 * Whether a route parameter holds a song's *identifier* rather than its slug,
 * for the `/songs/[id]` redirect.
 *
 * Both spellings Go's `uuid.Parse` takes that a slug could have: canonical and
 * dashless, which migration 000010 reserves out of slug space. Brace and
 * `urn:uuid:` forms cannot survive slugification, so they are not matched.
 */
export function songRefIsId(ref: string): boolean {
  return isUuid(ref);
}

/**
 * Whether this is an id in either spelling Go's `uuid.Parse` takes that a
 * link would carry: canonical and undashed, in either case. The parser's
 * braced and `urn:uuid:` forms are deliberately not ids here, so a person
 * filter spelled that way is treated as naming nobody rather than asked about.
 */
export function isUuid(value: string): boolean {
  return CANONICAL_UUID.test(value) || COMPACT_UUID.test(value);
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID = /^[0-9a-f]{32}$/i;

/**
 * The slug address an id-form address redirects to, query string intact, since
 * an old link is often `/songs/<uuid>?list=<id>`. `params` is Next's awaited
 * `searchParams`.
 *
 * Not `toQuery` (api/client.ts): that collapses repeated parameters and drops
 * empty ones, which would rewrite a shared link.
 */
export function songCanonicalHref(slug: string, params: NextSearchParams): string {
  const search = searchFrom(params).toString();
  const path = songHref({ slug });
  return search ? `${path}?${search}` : path;
}

/** A route's awaited `searchParams`, as Next hands them over. */
export type NextSearchParams = Record<string, string | string[] | undefined>;

/**
 * Next's `searchParams` as the address held them: every value of a repeated
 * key appended, so `?a=1&a=2` does not collapse, and `get` takes the first as
 * the seam's `useSearchParams` does. Every server route reads them through here.
 */
export function searchFrom(params: NextSearchParams): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) query.append(key, single);
  }
  return query;
}

/** Where a song sits in a list, and the addresses on either side of it. */
export interface ListPosition {
  listName: string;
  listHref: string;
  /** Zero-based, so what a reader is shown is `index + 1`. */
  index: number;
  total: number;
  /** Absent on the first song of the list, which is what draws the dead arrow. */
  previousHref?: string | undefined;
  /** Absent on the last one, for the same reason. */
  nextHref?: string | undefined;
}

/**
 * Locates a song in a list, as the addresses around it. Null when the song is
 * not in the list, which leaves the page without list navigation, not an error.
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
    listHref: listHref(list.id),
    index,
    total: songs.length,
    previousHref: href(songs[index - 1]),
    nextHref: href(songs[index + 1]),
  };
}
