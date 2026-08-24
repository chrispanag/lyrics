import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { cache } from "react";

import { apiFetch } from "@/api/client";
import { ClientOnly } from "@/app/client";
import { songByline } from "@/lib/credits";
import { songJsonLd } from "@/lib/jsonLd";
import { songCanonicalHref, songHref, songRefIsId } from "@/lib/listContext";
import { OG_IMAGE, SITE_ORIGIN } from "@/lib/site";
import type { Song } from "@/lib/types";

/*
 * A song's own address, taken off the catch-all.
 *
 * The body is still the same client-only app every other address renders — what
 * this segment adds is everything a *server* can say about a song while the app
 * below it is untouched: a description and a link card, a machine-readable
 * description of the work, and the one thing no client-side router can do, which
 * is answer an old address with a real redirect.
 */

/**
 * How long a song may be served from Next's data cache, in seconds.
 *
 * On the request and not as a `revalidate` segment export, which is where it
 * started and where it does nothing: a dynamic segment with no
 * `generateStaticParams` is rendered per request whatever that export says, so
 * the page was fetching the song again for every crawler that asked. Measured
 * both ways against `next start` — three requests, three API calls with the
 * export, one with this. There is deliberately no `generateStaticParams` either
 * way: `next build` runs in a container with no API on :8080 (web/Dockerfile),
 * so there is nothing to enumerate at build time.
 *
 * Five minutes is chosen against the one thing that goes stale — an edit to a
 * song, which changes this description and this JSON-LD and nothing a reader
 * sees, since the app below fetches for itself from the browser.
 */
const CACHE_SECONDS = 300;

/**
 * The song at an address, or null if it could not be read.
 *
 * `cache` so `generateMetadata` and the render below share one request rather
 * than each making their own — guaranteed by React for the life of the request,
 * where relying on fetch memoization would be relying on this module's own
 * headers staying memoizable. It is the layer above the data cache, not a
 * substitute: this one dedupes within a render, that one across them.
 *
 * Every failure is one answer, and null is the right one for all of them: a
 * mistyped slug, a deleted song and an API that is down are indistinguishable
 * from here, and each one leaves the client to render its own "not available".
 * `notFound()` would be the confident version of that and would be wrong — a
 * 404 for a song that exists behind an API having a bad minute. A failed request
 * is not written to the data cache, so a bad minute costs a minute rather than
 * the whole window above.
 *
 * `{ anonymous: true }` because a server render is a guest by construction: there
 * is no session here to read, and the flag also stops the 401 retry that exists
 * for one.
 */
const loadSong = cache(async (ref: string): Promise<Song | null> => {
  try {
    return await apiFetch<Song>(`/api/v1/songs/${encodeURIComponent(ref)}`, {
      anonymous: true,
      revalidate: CACHE_SECONDS,
    });
  } catch {
    return null;
  }
});

/**
 * What a crawler and a link preview are told about the song.
 *
 * There is deliberately **no `title`**, and it is the same rule app/layout.tsx
 * keeps one level up rather than a copy of it: a Next metadata title is a node
 * React renders from a segment above every route, so it sorts ahead of the one
 * `PageTitle` hoists, wins `document.title`, and then never changes again —
 * react-router does every in-app navigation and Next's router never runs, so
 * paging through a list would leave the tab naming the first song forever.
 * `og:title` is a different property and carries the name to the card.
 *
 * `openGraph` restates the site name and the image because a route's openGraph
 * *replaces* the layout's wholesale — Next merges metadata shallowly and the
 * docs recommend exactly this shared-constant shape for it — so a block naming
 * only the type and the title is a card with no picture on it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const song = await loadSong(id);
  // The layout's own description and card stand, which is the right answer for
  // an address that has no song behind it.
  if (!song) return {};

  const byline = songByline(song);
  const description = byline
    ? `Lyrics to “${song.title}” — ${byline}.`
    : `Lyrics to “${song.title}”.`;
  // The slug and not the requested ref: a song's canonical address is its slug
  // even when this render was reached through its id. Through `songHref`, like
  // every other destination in the app, so `/songs/` is not written here as
  // well.
  const path = songHref(song);

  return {
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "music.song",
      siteName: "Songfolio",
      url: path,
      title: song.title,
      description,
      images: [OG_IMAGE],
    },
  };
}

export default async function SongPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // Awaited only on the redirect path below, and left alone on the path every
  // reader takes. Awaiting it is what marks a render as needing the request, so
  // the habit of destructuring it at the top is the habit that opts a whole
  // route out of anything Next could otherwise have cached about it.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const song = await loadSong(id);

  // The permanent redirect from the id form to the slug, and the only place in
  // the stack that can issue one: a client-side router sees an address only
  // after something has already answered it. It does not retire
  // `songMatchesRef`, which still has to accept both forms — this needs the song
  // to know the slug, so an API having a bad minute serves the app at the id
  // address instead, and nothing in-app navigates between the forms at all.
  //
  // Outside `loadSong`'s catch by construction, and that matters:
  // `permanentRedirect` works by throwing, so a redirect issued inside a `try`
  // that swallows failures is swallowed along with them — leaving the old
  // address serving the app, exactly as it did before, with nothing to say the
  // redirect never happened.
  if (song && songRefIsId(id)) {
    permanentRedirect(songCanonicalHref(song.slug, await searchParams));
  }

  return (
    <>
      {song && (
        <script
          type="application/ld+json"
          // The one `dangerouslySetInnerHTML` in the app that carries
          // contributor-typed text. `songJsonLd` returns the script body already
          // escaped, which is why it returns text and not an object — see there.
          dangerouslySetInnerHTML={{
            __html: songJsonLd(song, `${SITE_ORIGIN}${songHref(song)}`),
          }}
        />
      )}
      <ClientOnly />
    </>
  );
}
