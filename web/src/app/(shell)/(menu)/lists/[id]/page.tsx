import type { Metadata } from "next";
import {
  type DehydratedState,
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from "@tanstack/react-query";
import { cache } from "react";

import { ApiError, apiFetch } from "@/api/client";
import { keys } from "@/api/hooks";
import { songCount } from "@/lib/format";
import { listJsonLd } from "@/lib/jsonLd";
import { OG_BASE, SITE_ORIGIN } from "@/lib/site";
import type { SongList } from "@/lib/types";
import { ListDetailPage } from "@/routes/ListsPages";

/*
 * A list's page. The server reads it as a guest, so only a public list is ever
 * rendered here: a private one renders nothing about itself, and its owner's
 * browser asks again once the session is restored. See CLAUDE.md, "What the
 * server renders".
 */

/**
 * What a guest may know about the list at an address:
 *
 * - the list: it is public, and this is it.
 * - `"hidden"`: the API refused to show it. Private and deleted answer alike,
 *   so this is never a 404: that would 404 an owner's own private list on every load.
 * - `null`: the API could not be asked. Nothing is claimed either way.
 */
type ServerList = SongList | "hidden" | null;

/**
 * The list, read once per request for both `generateMetadata` and the render.
 *
 * Never cached in Next's data cache: making a list private must stop the
 * server describing it at once, not minutes later. Always anonymous, since a
 * server render is a guest; an owner's token never reaches this read, which is
 * what keeps a private list out of the server's HTML whoever asks.
 *
 * A song with no `slug` (an API older than migration 000010) is treated as an
 * outage, as the song route treats one: its rows and JSON-LD would link to
 * `/songs/undefined`.
 */
const loadList = cache(async (id: string): Promise<ServerList> => {
  try {
    const list = await apiFetch<SongList>(`/api/v1/lists/${encodeURIComponent(id)}`, {
      anonymous: true,
    });
    return (list.songs ?? []).some((song) => !song.slug) ? null : list;
  } catch (caught) {
    // `bad_request` is a malformed id, which no list has: the same answer as 404.
    const refused =
      caught instanceof ApiError && (caught.code === "not_found" || caught.code === "bad_request");
    return refused ? "hidden" : null;
  }
});

/**
 * The list as `useList` keys it (by the address's id), for `HydrationBoundary`.
 * Stamped now, since the read was not cached: fresh, it spares a shared link's
 * every reader a second request for what the server just read.
 */
function cacheEntry(id: string, list: SongList): DehydratedState {
  const client = new QueryClient();
  client.setQueryData(keys.list(id), list);
  return dehydrate(client);
}

/**
 * What a link preview and a crawler are told. Never a `title`: `PageTitle`
 * names the tab (CLAUDE.md, Head assets). A list the guest cannot read says
 * nothing about itself and is `noindex`; an outage says nothing at all, since a
 * transient `noindex` could drop a public list from an index.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const list = await loadList(id);
  if (list === "hidden") return { robots: { index: false } };
  if (!list) return {};

  // The API exposes no owner name, so the count is the only other fact.
  const description = list.description
    ? `${list.description} — a list of ${songCount(list.item_count)}.`
    : `A list of ${songCount(list.item_count)}.`;
  const path = `/lists/${list.id}`;

  return {
    description,
    alternates: { canonical: path },
    openGraph: {
      ...OG_BASE,
      type: "website",
      url: path,
      title: list.name,
      description,
    },
  };
}

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const read = await loadList(id);
  const list = read === "hidden" ? null : read;

  return (
    <>
      {list && (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: owner-typed text, which `listJsonLd` returns already escaped.
          dangerouslySetInnerHTML={{ __html: listJsonLd(list, SITE_ORIGIN) }}
        />
      )}
      {/* No state for a list the guest cannot read: the page waits for the
          session and asks with the reader's token, as it always has. */}
      <HydrationBoundary state={list ? cacheEntry(id, list) : undefined}>
        <ListDetailPage />
      </HydrationBoundary>
    </>
  );
}
