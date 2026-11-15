import type { MetadataRoute } from "next";

import { apiFetch, toQuery } from "@/api/client";
import { genrePageHref, personPageHref } from "@/lib/browse";
import { isUuid, listHref, songHref } from "@/lib/listContext";
import { SITE_ORIGIN } from "@/lib/site";
import type { CreditedPerson, Genre, ListResponse, PublicList, Song } from "@/lib/types";

// Absolute URLs throughout: `metadataBase` is not read here.

// Without this the sitemap is evaluated at build time, with no API, and ships
// empty until the next deploy.
export const dynamic = "force-dynamic";

// The API clamps `limit` to 100 (httpx.Pagination).
const PAGE = 100;

type Entry = MetadataRoute.Sitemap[number];

/**
 * The catalog's address, every genre's and every person's catalog page, every
 * song's and every public list's, or the static routes alone.
 *
 * All or nothing, across every read: a sitemap missing half the songs, or
 * every list, looks exactly like a smaller catalog. The cause is logged, since
 * nothing else reports it.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const home = { url: `${SITE_ORIGIN}/` };
  try {
    const [genres, people, songs, lists] = await Promise.all([
      genreEntries(),
      walk<CreditedPerson>("/api/v1/credited-people", {}, personEntry),
      walk<Song>("/api/v1/songs", { sort: "oldest" }, songEntry),
      walk<PublicList>("/api/v1/public-lists", {}, listEntry),
    ]);
    return [home, ...genres, ...people, ...songs, ...lists];
  } catch (caught) {
    console.error("sitemap: could not enumerate the catalog", caught);
    return [home];
  }
}

/**
 * Every row of a paginated collection, as sitemap entries. Each collection
 * walks a total order in which new rows append (`sort=oldest` for songs, the
 * only order `/credited-people` and `/public-lists` have), so pages cannot
 * shift and the first answer's `meta.total` fixes every offset up front.
 */
async function walk<T>(
  path: string,
  query: Record<string, string>,
  entry: (row: T) => Entry,
): Promise<Entry[]> {
  const page = (offset: number) =>
    apiFetch<ListResponse<T>>(`${path}${toQuery({ ...query, limit: PAGE, offset })}`, {
      anonymous: true,
    });

  const first = await page(0);
  const rest = await Promise.all(offsetsAfterFirst(first.meta.total).map(page));
  return [first, ...rest].flatMap(({ data }) => data.map(entry));
}

/** `[PAGE, 2 * PAGE, …]`, stopping before `total`. Empty for a collection of one page. */
function offsetsAfterFirst(total: number): number[] {
  const offsets: number[] = [];
  for (let offset = PAGE; offset < total; offset += PAGE) offsets.push(offset);
  return offsets;
}

/**
 * Every genre with a song, read in one request: `/genres` is unpaginated, and
 * small enough to stay so. A genre on no song is left out, its page being an
 * empty catalog. No `lastModified`, here or for a person: a removed song
 * changes the page and leaves no date behind, so any date would claim the page
 * older than it is.
 */
async function genreEntries(): Promise<Entry[]> {
  const { data } = await apiFetch<ListResponse<Genre>>("/api/v1/genres", { anonymous: true });
  return data
    .filter(hasSongs)
    .map((genre) => ({ url: `${SITE_ORIGIN}${genrePageHref(genre.slug)}` }));
}

/**
 * Whether a genre is worth listing. The API omits a count of zero, so an
 * absent one is zero. A genre with no slug throws rather than being dropped,
 * as a song with none does.
 */
function hasSongs(genre: Genre): boolean {
  if (!genre.slug) throw new Error(`genre ${genre.id} has no slug`);
  return (genre.song_count ?? 0) > 0;
}

/** A person's page, under the address their catalog page names as canonical. */
function personEntry(person: CreditedPerson): Entry {
  if (!isUuid(person.id ?? "")) throw new Error(`credited person ${person.id} has no id`);
  return { url: `${SITE_ORIGIN}${personPageHref(person.id)}` };
}

/**
 * A row with no `slug` (an API older than migration 000010) throws rather than
 * being filtered, so the walk fails whole instead of publishing
 * `/songs/undefined` or a shorter sitemap.
 */
function songEntry(song: Song): Entry {
  if (!song.slug) throw new Error(`song ${song.id} has no slug`);
  return { url: `${SITE_ORIGIN}${songHref(song)}`, lastModified: song.updated_at };
}

function listEntry(list: PublicList): Entry {
  return { url: `${SITE_ORIGIN}${listHref(list.id)}`, lastModified: list.updated_at };
}
