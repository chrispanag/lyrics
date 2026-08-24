import type { MetadataRoute } from "next";

import { apiFetch, toQuery } from "@/api/client";
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
 * lets the catalog grow between two requests and shift a row across the page
 * boundary, so a crawler is handed one song twice and never shown another.
 * `meta.total` is the authority for how far to walk rather than "a page came back
 * short", which is a guess about a server that is being asked anyway.
 *
 * A failure yields nothing rather than what had been collected so far, and that
 * is the deliberate half: a truncated sitemap is indistinguishable from a small
 * catalog, so half the songs going unindexed would look exactly like success.
 * The static routes alone look broken, which is the failure that gets noticed.
 * Swallowing at all is belt to the suspenders above — however this route comes
 * to be classified, a build can never fail on the API being unreachable.
 */
async function songEntries(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  try {
    for (let offset = 0, total = 1; offset < total; offset += PAGE) {
      const page = await apiFetch<ListResponse<Song>>(
        `/api/v1/songs${toQuery({ limit: PAGE, offset, sort: "oldest" })}`,
        { anonymous: true },
      );
      total = page.meta.total;
      // A page shorter than the total claims is a server disagreeing with
      // itself; stopping is what keeps that from being an endless walk.
      if (page.data.length === 0) break;
      for (const song of page.data) {
        entries.push({ url: `${SITE_ORIGIN}/songs/${song.slug}`, lastModified: song.updated_at });
      }
    }
    return entries;
  } catch {
    return [];
  }
}
