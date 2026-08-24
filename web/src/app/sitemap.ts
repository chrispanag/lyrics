import type { MetadataRoute } from "next";

import { apiFetch, toQuery } from "@/api/client";
import { songHref } from "@/lib/listContext";
import { SITE_ORIGIN } from "@/lib/site";
import type { ListResponse, Song } from "@/lib/types";

/*
 * The crawlable index of the catalog.
 *
 * Every song is a client-rendered page, so this is what stands between the
 * catalog and being discovered one link at a time. Absolute URLs throughout,
 * because the sitemap specification requires them and because `metadataBase` —
 * which resolves the relative URLs inside metadata — is not read here.
 */

// A sitemap is a Route Handler that Next caches by default, and a build has no
// API to enumerate from: `next build` runs in a container with nothing on :8080,
// so a sitemap evaluated then would ship empty and stay empty until the next
// deploy. This is the documented way to force per-request evaluation.
export const dynamic = "force-dynamic";

// The API clamps `limit` to 100 (httpx.Pagination), so asking for more is a
// round trip that answers with a hundred rows anyway.
const PAGE = 100;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [{ url: `${SITE_ORIGIN}/` }, ...(await songEntries())];
}

/**
 * Every song's address, or none at all.
 *
 * `sort=oldest` is `created_at ASC, id ASC` — a total order, tie-broken, in which
 * a song added mid-walk appends rather than displacing anything. Any other sort
 * lets the catalog grow between two requests and shift a row across a page
 * boundary, so a crawler is handed one song twice and never shown another. That
 * stability is also what lets the rest of the pages go out at once: `meta.total`
 * from the first answer fixes every remaining offset, so the ten requests this
 * takes today are one round trip and not ten — and on App Platform each one
 * leaves the process and comes back through the public ingress.
 *
 * A failure yields nothing rather than what had been collected so far, and that
 * is the deliberate half: a truncated sitemap is indistinguishable from a small
 * catalog, so half the songs going unindexed would look exactly like success.
 * The static routes alone look broken, which is the failure that gets noticed.
 * `Promise.all` keeps that — one rejection is the whole walk's. Swallowing at all
 * is belt to the suspenders above: however this route comes to be classified, a
 * build can never fail on the API being unreachable.
 */
async function songEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const first = await songPage(0);
    const rest = await Promise.all(
      // From the second page to the last, by the total the first page reported.
      // No page is asked for beyond it, so a short answer needs no handling: the
      // walk's length was decided before any of these went out.
      offsetsAfterFirst(first.meta.total).map((offset) => songPage(offset)),
    );

    return [first, ...rest].flatMap((page) => page.data.map(entry));
  } catch {
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

/** Through `songHref`, so `/songs/` is not written here as well. */
function entry(song: Song): MetadataRoute.Sitemap[number] {
  return { url: `${SITE_ORIGIN}${songHref(song)}`, lastModified: song.updated_at };
}
