import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { cache } from "react";

import { apiFetch } from "@/api/client";
import { ClientOnly } from "@/app/client";
import { songByline } from "@/lib/credits";
import { songJsonLd } from "@/lib/jsonLd";
import { songCanonicalHref, songHref, songRefIsId } from "@/lib/listContext";
import { OG_BASE, SITE_ORIGIN } from "@/lib/site";
import type { Song } from "@/lib/types";

/*
 * Same client-only app as the catch-all, plus what a server can say: metadata,
 * JSON-LD, and a real redirect from the id form to the slug.
 */

/**
 * Seconds a song may be served from Next's data cache. Set on the request: a
 * `revalidate` segment export does nothing on a dynamic route. No
 * `generateStaticParams`, since `next build` has no API to enumerate.
 */
const CACHE_SECONDS = 300;

/**
 * The song at an address, or null if it could not be read.
 *
 * `cache` shares one request between `generateMetadata` and the render. Every
 * failure is null, never `notFound()`: an API outage must not 404 a real song.
 * A server render is always a guest, hence `anonymous`.
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
  } catch {
    return null;
  }
});

/**
 * What a crawler and a link preview are told about the song.
 *
 * Never return a `title`: it would win `document.title` and never change, since
 * react-router does every navigation (CLAUDE.md, Head assets). Spreads
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
      <ClientOnly />
    </>
  );
}
