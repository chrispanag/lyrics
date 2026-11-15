import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  type DehydratedState,
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from "@tanstack/react-query";
import { cache } from "react";

import { ApiError, apiFetch } from "@/api/client";
import { keys } from "@/api/hooks";
import { songByline } from "@/lib/credits";
import { songJsonLd } from "@/lib/jsonLd";
import { songCanonicalHref, songHref, songRefIsId } from "@/lib/listContext";
import { OG_BASE, SITE_ORIGIN } from "@/lib/site";
import type { Song } from "@/lib/types";
import { SongDetailPage } from "@/routes/SongDetailPage";

/*
 * The song page, rendered on the server from the song this module reads, plus
 * what only a server can say: metadata, JSON-LD, a real redirect from the id
 * form to the slug, and a real 404 (`./not-found.tsx`).
 */

/**
 * Seconds a song may be served from Next's data cache. Set on the request: a
 * `revalidate` segment export does nothing on a dynamic route. No
 * `generateStaticParams`, since `next build` has no API to enumerate.
 */
const CACHE_SECONDS = 300;

/**
 * The song at an address, or null if it could not be read. Throws `notFound()`
 * when the API says no song has the address.
 *
 * `cache` shares one request, and that throw, between `generateMetadata` and
 * the render. Only the API's own `not_found` 404s: a bare 404 from whatever
 * sits in front of the API, or the router's `no_route` when an ingress drops
 * the /api prefix, is an outage, and an outage must not 404 a real song.
 * An outage renders the page with no song handed over, and the browser asks
 * again and says so in its own words. A server render is always a guest, hence `anonymous`.
 *
 * A song with no `slug` (an API older than migration 000010) is also null:
 * otherwise `songHref` builds `/songs/undefined` for the 308, the canonical and
 * the JSON-LD.
 */
const loadSong = cache(async (ref: string): Promise<Song | null> => {
  try {
    const song = await apiFetch<Song>(`/api/v1/songs/${encodeURIComponent(ref)}`, {
      anonymous: true,
      revalidate: CACHE_SECONDS,
    });
    return song.slug ? song : null;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404 && caught.code === "not_found") {
      notFound();
    }
    return null;
  }
});

/**
 * The song as the app's query cache holds it, for `HydrationBoundary`.
 *
 * Stamped as old as possible: the read may be minutes stale (Next's data
 * cache), so the app draws it and refetches at once. Fresh, a reader who
 * reloads after an edit would see the version before it. Keyed by the address,
 * as `useSong` keys it.
 */
function cacheEntry(ref: string, song: Song): DehydratedState {
  const client = new QueryClient();
  client.setQueryData(keys.song(ref), song, { updatedAt: 0 });
  return dehydrate(client);
}

/**
 * What a crawler and a link preview are told about the song.
 *
 * Never return a `title`: `PageTitle` names the tab, and a second <title> would
 * race it for `document.title` (CLAUDE.md, Head assets). Spreads
 * `OG_BASE` because a route's openGraph replaces the layout's wholesale.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const song = await loadSong(id);
  // No song: the layout's description and card stand.
  if (!song) return {};

  const byline = songByline(song);
  const description = byline
    ? `Lyrics to “${song.title}” — ${byline}.`
    : `Lyrics to “${song.title}”.`;
  // Canonical is the slug, even when reached through the id.
  const path = songHref(song);

  return {
    description,
    alternates: { canonical: path },
    openGraph: {
      ...OG_BASE,
      type: "music.song",
      url: path,
      title: song.title,
      description,
    },
  };
}

export default async function SongPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // Awaited only on the redirect path: awaiting it opts the route out of caching.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const song = await loadSong(id);

  // The id form redirects to the slug. `songMatchesRef` must still accept both
  // forms, since this needs the API to be up.
  //
  // `permanentRedirect` throws, so it must stay outside any `try` that swallows
  // errors, or the redirect silently never happens.
  if (song && songRefIsId(id)) {
    permanentRedirect(songCanonicalHref(song.slug, await searchParams));
  }

  return (
    <>
      {song && (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: contributor-typed text, which `songJsonLd` returns already escaped.
          dangerouslySetInnerHTML={{
            __html: songJsonLd(song, `${SITE_ORIGIN}${songHref(song)}`),
          }}
        />
      )}
      {/* The server's copy, which the page renders from at once — here and in
          the browser's first render — and refetches, since it may be stale. */}
      <HydrationBoundary state={song ? cacheEntry(id, song) : undefined}>
        <SongDetailPage />
      </HydrationBoundary>
    </>
  );
}
