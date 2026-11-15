import type { Metadata } from "next";
import { HydrationBoundary, QueryClient, dehydrate } from "@tanstack/react-query";
import { cache } from "react";

import { guestRead, isNotFound } from "@/api/client";
import { queries } from "@/api/hooks";
import { type CatalogView, browseHref, catalogName, catalogView, viewGenre } from "@/lib/browse";
import { songCount } from "@/lib/format";
import { websiteJsonLd } from "@/lib/jsonLd";
import { type NextSearchParams, isUuid, searchFrom } from "@/lib/listContext";
import { OG_BASE, SITE_NAME, SITE_SUMMARY } from "@/lib/site";
import { BrowsePage } from "@/routes/BrowsePage";

/*
 * The catalog, rendered on the server from the reads `BrowsePage` would make
 * on its first render, plus what only a server can say: which views are pages
 * worth indexing, and the site's own JSON-LD.
 */

interface Props {
  searchParams: Promise<NextSearchParams>;
}

/**
 * The request's query client, shared through `cache` by `generateMetadata` and
 * the render, so each read is made once per request. The reads are the hooks'
 * own `queries`, so what is handed over sits under the key the hook asks for.
 *
 * `prefetchQuery` never throws: a failed read is left out of the handover and
 * the browser asks again and says so in its own words — never a 500. No retry,
 * and a time budget per read (`guestRead`): a server render must not wait
 * out an outage. Fresh for the length of the request, so the second caller
 * reuses the first's answer — a success, that is; `readNamed` is what keeps a
 * failure from being asked twice.
 *
 * Not cached across requests (no `revalidate`), unlike a song: every search
 * string is its own address, so a data cache would be keyed by text anyone can
 * type, and a fresh read is what lets the entry be stamped with when it was
 * read rather than as stale, so the browser does not ask again on load.
 */
const requestClient = cache(
  () =>
    new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    }),
);

async function viewOf(searchParams: Promise<NextSearchParams>): Promise<CatalogView> {
  return catalogView(searchFrom(await searchParams));
}

/**
 * The genres and the person a view names, read into the request's client.
 * Shared through `cache` as well, because the client alone does not make a
 * read once: a query that failed holds no data, so `prefetchQuery` would ask
 * again, and the page would wait out a second timeout after `generateMetadata`
 * waited out the first. A person id the API could not parse names nobody, and
 * is not asked about.
 */
const readNamed = cache(async (client: QueryClient, personId: string) => {
  const askPerson = isUuid(personId);
  const genres = queries.genres(guestRead());
  // Only a read that is made starts a clock; the key is the same either way.
  const person = queries.person(personId, askPerson ? guestRead() : undefined);
  await Promise.all([
    client.prefetchQuery(genres),
    askPerson ? client.prefetchQuery(person) : undefined,
  ]);
  return {
    genres: client.getQueryData(genres.queryKey)?.data,
    person: client.getQueryData(person.queryKey),
    personUnknown: !askPerson || isNotFound(client.getQueryState(person.queryKey)?.error),
  };
});

/**
 * The genre and the person a view names, which is all its metadata needs, and
 * whether the API said either names nothing. Only the API's own `not_found`
 * counts, as on the song route: an outage must not deindex a page.
 */
async function namedOf(view: CatalogView) {
  const { genres, person, personUnknown } = await readNamed(requestClient(), view.personId);
  const genre = viewGenre(view, genres);
  return { genre, person, personUnknown, genreUnknown: Boolean(genres) && !genre };
}

type Named = Awaited<ReturnType<typeof namedOf>>;

/**
 * The address a view is canonical under, or none when it is not a page worth
 * a search result — which `noindex` says instead, never both, since the two
 * together contradict each other.
 *
 * The landing pages are the plain catalog, one person's songs and one genre's:
 * each a stable list a reader would search for by name. Each is canonical
 * under its own filter alone, so a sort is folded into it. Everything else is
 * `noindex, follow` — still crawled through for the songs it links to, never
 * listed itself: a search (an address space anyone can mint, of thin and
 * overlapping results), a later page (a different slice, so a canonical to
 * page one would be a false claim, and the sitemap already lists every song),
 * a language or a combination of filters, and a filter the API says names
 * nothing. A filter that could not be resolved for an outage stays indexable.
 */
function canonicalOf(view: CatalogView, named: Named): string | undefined {
  if (view.page > 0 || view.language) return undefined;
  switch (view.subject) {
    case "catalog":
      return "/";
    case "person":
      // The person's own id, not the address's spelling of it: the API also
      // takes upper case and the undashed form, each a duplicate of this page.
      // Unread for an outage, the address's own spelling is normalized instead.
      return named.personUnknown
        ? undefined
        : browseHref({ person: named.person?.id ?? canonicalUuid(view.personId) });
    case "genre":
      return named.genreUnknown ? undefined : browseHref({ genre_slug: view.genreSlug });
    default:
      return undefined;
  }
}

/** An id `isUuid` accepts, in the lower-case dashed form the API answers with. */
function canonicalUuid(id: string): string {
  const hex = id.toLowerCase().replaceAll("-", "");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** "12 songs", or "songs" when the API did not count them. */
function songsOf(count: number | undefined): string {
  return count === undefined ? "songs" : songCount(count);
}

/** What a result or a link preview says about the view, beyond the site's own words. */
function descriptionOf(view: CatalogView, { genre, person }: Named): string | undefined {
  switch (view.subject) {
    case "search":
      return `Songs matching “${view.query}” in the ${SITE_NAME} catalog.`;
    case "person":
      return (
        person && `Lyrics to ${songsOf(person.song_count)} by ${person.name}, written or performed.`
      );
    case "genre":
      return genre && `Lyrics to ${songsOf(genre.song_count)} of ${genre.name}.`;
    default:
      return undefined;
  }
}

/**
 * What a crawler and a link preview are told about the view.
 *
 * Never return a `title`: `PageTitle` names the tab, from the same
 * `catalogName` as `og:title` here (CLAUDE.md, Head assets). Spreads `OG_BASE`
 * because a route's openGraph replaces the layout's wholesale. Waits on the
 * genre and the person only, never the songs page.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const view = await viewOf(searchParams);
  const named = await namedOf(view);
  const description = descriptionOf(view, named);
  const canonical = canonicalOf(view, named);

  return {
    // Absent, the layout's site description stands.
    ...(description ? { description } : {}),
    ...(canonical ? { alternates: { canonical } } : { robots: { index: false, follow: true } }),
    openGraph: {
      ...OG_BASE,
      type: "website",
      ...(canonical ? { url: canonical } : {}),
      title: catalogName(view, named) ?? SITE_NAME,
      description: description ?? SITE_SUMMARY,
    },
  };
}

export default async function CatalogPage({ searchParams }: Props) {
  const view = await viewOf(searchParams);
  const client = requestClient();
  await Promise.all([
    client.prefetchQuery(queries.songs(view.filters, guestRead())),
    readNamed(client, view.personId),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: `websiteJsonLd` returns its text already escaped.
        dangerouslySetInnerHTML={{ __html: websiteJsonLd() }}
      />
      {/* The server's reads, which the page renders from at once — here and
          in the browser's first render — with no second round trip. Only
          successful reads are dehydrated. */}
      <HydrationBoundary state={dehydrate(client)}>
        <BrowsePage />
      </HydrationBoundary>
    </>
  );
}
