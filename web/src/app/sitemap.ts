import type { MetadataRoute } from "next";

import { apiFetch, toQuery } from "@/api/client";
import { songHref } from "@/lib/listContext";
import { SITE_ORIGIN } from "@/lib/site";
import type { ListResponse, Song } from "@/lib/types";

// Absolute URLs throughout: `metadataBase` is not read here.

// Without this the sitemap is evaluated at build time, with no API, and ships
// empty until the next deploy.
export const dynamic = "force-dynamic";

// The API clamps `limit` to 100 (httpx.Pagination).
const PAGE = 100;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [{ url: `${SITE_ORIGIN}/` }, ...(await songEntries())];
}

/**
 * Every song's address, or none at all.
 *
 * `sort=oldest` is a total order where new songs append, so pages cannot shift
 * and `meta.total` fixes every offset up front. All or nothing: a truncated
 * sitemap looks like a small catalog. The cause is logged, since nothing else
 * reports it.
 */
async function songEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const first = await songPage(0);
    const rest = await Promise.all(
      offsetsAfterFirst(first.meta.total).map((offset) => songPage(offset)),
    );

    return [first, ...rest].flatMap((page) => page.data.map(entry));
  } catch (caught) {
    console.error("sitemap: could not enumerate the catalog", caught);
    return [];
  }
}

/** `[PAGE, 2 * PAGE, …]`, stopping before `total`. Empty for a catalog of one page. */
function offsetsAfterFirst(total: number): number[] {
  const offsets: number[] = [];
  for (let offset = PAGE; offset < total; offset += PAGE) offsets.push(offset);
  return offsets;
}

function songPage(offset: number): Promise<ListResponse<Song>> {
  return apiFetch<ListResponse<Song>>(
    `/api/v1/songs${toQuery({ limit: PAGE, offset, sort: "oldest" })}`,
    { anonymous: true },
  );
}

/**
 * A row with no `slug` (an API older than migration 000010) throws rather than
 * being filtered, so the walk fails whole instead of publishing
 * `/songs/undefined` or a shorter sitemap.
 */
function entry(song: Song): MetadataRoute.Sitemap[number] {
  if (!song.slug) throw new Error(`song ${song.id} has no slug`);
  return { url: `${SITE_ORIGIN}${songHref(song)}`, lastModified: song.updated_at };
}
