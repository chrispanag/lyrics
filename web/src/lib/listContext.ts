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
 */
export function songHref(song: Pick<Song, "slug">, listId?: string): string {
  const path = `/songs/${song.slug}`;
  return listId ? `${path}?${LIST_PARAM}=${encodeURIComponent(listId)}` : path;
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
  return CANONICAL_UUID.test(ref) || COMPACT_UUID.test(ref);
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
export function songCanonicalHref(
  slug: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    // Append each, so `?a=1&a=2` does not collapse.
    for (const single of Array.isArray(value) ? value : [value]) query.append(key, single);
  }
  const search = query.toString();
  const path = songHref({ slug });
  return search ? `${path}?${search}` : path;
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
