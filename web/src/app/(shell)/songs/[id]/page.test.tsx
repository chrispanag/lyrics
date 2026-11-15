// @vitest-environment node
import { type DehydratedState, HydrationBoundary } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/api/hooks";
import { RouteParams } from "@/lib/navigation";
import { TestProviders } from "@/test/TestProviders";
import { API, apiError, makeSong, makeUnaddressedSong, songByRef } from "@/test/handlers";
import { server } from "@/test/server";

/*
 * Pins the route's wiring (the 308, the absent title, the JSON-LD, the song
 * handed to the page); the helpers have their own specs. The async component
 * is called and its tree inspected, then rendered to a string the way the
 * server sends it. Under Node: this module is server code.
 */

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const SLUG = "thalassa-platia";

/** What `permanentRedirect` throws, so a spec can see where it was sent. */
class Redirected extends Error {
  readonly location: string;

  constructor(location: string) {
    super(`redirected to ${location}`);
    this.location = location;
  }
}

/** What `notFound` throws. */
class NotFound extends Error {}

vi.mock("next/navigation", () => ({
  // The real ones throw too, which is what stops the render.
  permanentRedirect: (location: string) => {
    throw new Redirected(location);
  },
  notFound: () => {
    throw new NotFound();
  },
}));

const { default: SongPage, generateMetadata } = await import("./page");
const { SongDetailPage } = await import("@/routes/SongDetailPage");
const { default: SongNotFound } = await import("./not-found");

/** Answers the song at both of its addresses, and 404s anything else. */
function servingSong(song = makeSong({ id: UUID, slug: SLUG })) {
  return songByRef(song);
}

const props = (id: string, search: Record<string, string | string[]> = {}) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(search),
});

/** The page's top-level elements, a `false` from each `&&` left out. */
function topLevel(tree: ReactElement): ReactElement<Record<string, unknown>>[] {
  return (tree.props as { children: unknown[] }).children.flat().filter(Boolean) as ReactElement<
    Record<string, unknown>
  >[];
}

/** The JSON-LD script's body, or null when the page rendered no script at all. */
function structuredData(tree: ReactElement): string | null {
  const script = topLevel(tree).find((node) => node.props.type === "application/ld+json");
  const inner = script?.props.dangerouslySetInnerHTML as { __html: string } | undefined;
  return inner?.__html ?? null;
}

/** The page's top-level element of a given component, if it rendered one. */
function child<P>(tree: ReactElement, type: unknown): ReactElement<P> | undefined {
  return topLevel(tree).find((node) => node.type === type) as ReactElement<P> | undefined;
}

beforeEach(() => server.use(servingSong()));

describe("a song's server-rendered document", () => {
  it("describes the song without ever naming a title", async () => {
    const metadata = await generateMetadata(props(SLUG));

    // A metadata title would win `document.title` and never change again.
    expect(metadata).not.toHaveProperty("title");
    expect(metadata.openGraph?.title).toBe("Θάλασσα Πλατιά");
    expect(metadata.alternates?.canonical).toBe(`/songs/${SLUG}`);
    // A route's openGraph replaces the layout's, so these must be restated.
    expect(metadata.openGraph).toMatchObject({ siteName: "Songfolio" });
    expect(metadata.openGraph?.images).toBeDefined();
  });

  it("points an agent at the song's JSON under its slug, whichever address was asked", async () => {
    // Asked by id: the alternate still names the slug, like the canonical.
    const metadata = await generateMetadata(props(UUID));

    expect(metadata.alternates?.types).toEqual({
      "application/json": `/api/v1/songs/${SLUG}`,
    });
  });

  it("carries the structured description of the song it is serving", async () => {
    const body = structuredData(await SongPage(props(SLUG)));

    expect(body).toContain('"@type":"MusicComposition"');
    // jsonLd.test.ts pins the escaping; this pins that the page uses it.
    expect(body).not.toContain("<");
  });

  it("sends an id-form address to the slug, keeping the list it was read from", async () => {
    // Dropping `?list=` would strand the reader outside the list.
    await expect(SongPage(props(UUID, { list: "list-1" }))).rejects.toThrow(
      new Redirected(`/songs/${SLUG}?list=list-1`),
    );
  });

  it("renders the song page, handed the song it read", async () => {
    const tree = await SongPage(props(SLUG));

    const boundary = child<{ children: ReactElement; state?: DehydratedState }>(
      tree,
      HydrationBoundary,
    );
    expect(boundary?.props.children.type).toBe(SongDetailPage);
    const entries = boundary?.props.state?.queries ?? [];
    expect(entries).toHaveLength(1);
    const [{ queryKey, state }] = entries as [DehydratedState["queries"][number]];
    // Keyed as `useSong` keys it: the address, not the id.
    expect(queryKey).toEqual(keys.song(SLUG));
    expect((state.data as { id: string }).id).toBe(UUID);
    // The read may be minutes old, so the page must refetch it at once.
    expect(state.dataUpdatedAt).toBe(0);
  });

  // What a crawler, an agent or a screen reader gets before any JavaScript:
  // the song itself, in its own language, and a title naming it.
  it("sends the song's title, credits and lyrics in the HTML", async () => {
    const tree = await SongPage(props(SLUG));

    const html = renderToString(
      <TestProviders route={`/songs/${SLUG}`}>
        <RouteParams params={{ id: SLUG }}>{tree}</RouteParams>
      </TestProviders>,
    );

    expect(html).toContain("<title>Θάλασσα Πλατιά — Songfolio</title>");
    expect(html).toMatch(/<h1[^>]*>Θάλασσα Πλατιά<\/h1>/);
    expect(html).toMatch(/<header[^>]*lang="el"/);
    expect(html).toContain("Μίκης Θεοδωράκης");
    expect(html).toMatch(/<p[^>]*lang="el"[^>]*>Στης θάλασσας τα βάθη/);
  });

  it("answers 404 when the API says no such song exists", async () => {
    await expect(SongPage(props("no-such-song"))).rejects.toThrow(NotFound);
    await expect(generateMetadata(props("no-such-song"))).rejects.toThrow(NotFound);
  });

  it.each([
    [
      "a bare 404 from something in front of the API",
      () => new HttpResponse("Not Found", { status: 404 }),
    ],
    // What the Go router answers when an ingress drops the /api prefix.
    ["the API's own unmatched route", () => apiError(404, "no_route", "No such endpoint.")],
  ])("does not 404 on %s", async (_, answer) => {
    // A misrouting answers 404 for every song; that must not deindex them.
    server.use(http.get(`${API}/api/v1/songs/:ref`, answer));

    const tree = await SongPage(props(SLUG));

    expect(child(tree, HydrationBoundary)).toBeDefined();
  });

  it("renders the page to ask again, rather than redirecting, when the song cannot be read", async () => {
    server.use(http.get(`${API}/api/v1/songs/:ref`, () => HttpResponse.error()));

    // No redirect (the slug is unknown) and no 404: the client renders its own state.
    const tree = await SongPage(props(UUID, { list: "list-1" }));

    expect(structuredData(tree)).toBeNull();
    expect(child<{ state?: unknown }>(tree, HydrationBoundary)?.props.state).toBeUndefined();
    expect(await generateMetadata(props(UUID))).toEqual({});
  });

  it("refuses a song carrying no address rather than redirecting to one", async () => {
    // An API older than migration 000010 omits the field; `songHref` would
    // build a permanent redirect to `/songs/undefined`.
    server.use(servingSong(makeUnaddressedSong({ id: UUID })));

    const tree = await SongPage(props(UUID));

    expect(structuredData(tree)).toBeNull();
    expect(await generateMetadata(props(UUID))).toEqual({});
  });
});

describe("a song the API says does not exist", () => {
  // The page's own words, under the search header that carries the hamburger:
  // a dead song link is no reason to strand a phone without its navigation.
  it("is named as not available, with the way to the navigation", () => {
    const html = renderToString(
      <TestProviders route="/songs/no-such-song">
        <SongNotFound />
      </TestProviders>,
    );

    expect(html).toContain("<title>Song not available — Songfolio</title>");
    expect(html).toContain("No song has this address.");
    expect(html).toContain("Open menu");
  });
});
