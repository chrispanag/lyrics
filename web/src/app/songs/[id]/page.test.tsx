// @vitest-environment node
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API, makeSong, notFound } from "@/test/handlers";
import { server } from "@/test/server";

/*
 * The route that composes everything the server says about a song.
 *
 * Its helpers were each pinned before this existed and the module joining them
 * was not, which is exactly how a permanent redirect to `/songs/undefined`
 * passed the whole suite: `songHref` was given a song with no slug and did the
 * only thing it could with one. So what this covers is the *wiring* — the 308
 * and where it points, the title that must not be there, and whether the JSON-LD
 * is in the tree at all — rather than anything the helpers already own.
 *
 * `@vitest-environment node`, like `sitemap.test.ts`: this module runs in the
 * Node process and reaches the API through `api/client.ts`'s server branch.
 *
 * The page is an async server component, so it is *called* and its returned tree
 * inspected rather than rendered. A renderer is no use here — `<ClientOnly/>` is
 * `next/dynamic` with `ssr: false`, which has nothing to render outside a Next
 * build — and the tree is anyway the thing under test: whether the script node
 * is there, and what is in it.
 */

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const SLUG = "thalassa-platia";

/** What `permanentRedirect` throws, so a spec can see where it was sent. */
class Redirected extends Error {
  constructor(readonly location: string) {
    super(`redirected to ${location}`);
  }
}

vi.mock("next/navigation", () => ({
  // The real one throws too, which is what stops the render continuing — so
  // throwing here is not a convenience, it is the behavior the page is written
  // around.
  permanentRedirect: (location: string) => {
    throw new Redirected(location);
  },
}));

// Imported after the mock is declared. `vi.mock` is hoisted above these, so the
// order reads wrong and is right.
const { default: SongPage, generateMetadata } = await import("./page");

/** Answers the song at both of its addresses, and 404s anything else. */
function servingSong(song = makeSong({ id: UUID, slug: SLUG })) {
  return http.get(`${API}/api/v1/songs/:ref`, ({ params }) =>
    params.ref === song.id || params.ref === song.slug
      ? HttpResponse.json(song)
      : notFound("Song was not found."),
  );
}

const props = (id: string, search: Record<string, string | string[]> = {}) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(search),
});

/**
 * The JSON-LD script's body, or null when the page rendered no script at all.
 *
 * Walks the returned tree because the alternative is asserting on a string this
 * page cannot be rendered to. `false` is what the `song && …` guard leaves in
 * the children when there is nothing to describe.
 */
function structuredData(tree: ReactElement): string | null {
  const children = (tree.props as { children: unknown[] }).children;
  for (const child of children.flat()) {
    const node = child as ReactElement<{
      type?: string;
      dangerouslySetInnerHTML?: { __html: string };
    }> | null;
    if (node && node.props?.type === "application/ld+json") {
      return node.props.dangerouslySetInnerHTML?.__html ?? null;
    }
  }
  return null;
}

beforeEach(() => server.use(servingSong()));

describe("a song's server-rendered document", () => {
  it("describes the song without ever naming a title", async () => {
    const metadata = await generateMetadata(props(SLUG));

    // The load-bearing assertion, and it is about a key's *absence*: a metadata
    // title from any segment above a route wins `document.title` and then never
    // moves again, because react-router does every in-app navigation from there
    // on. Paging a list would leave the tab naming the first song forever.
    expect(metadata).not.toHaveProperty("title");
    expect(metadata.openGraph?.title).toBe("Θάλασσα Πλατιά");
    expect(metadata.alternates?.canonical).toBe(`/songs/${SLUG}`);
    // Restated by the route rather than inherited: Next replaces a whole
    // openGraph block rather than merging it, so a card with no picture is what
    // dropping these looks like.
    expect(metadata.openGraph).toMatchObject({ siteName: "Songfolio" });
    expect(metadata.openGraph?.images).toBeDefined();
  });

  it("carries the structured description of the song it is serving", async () => {
    const body = structuredData(await SongPage(props(SLUG)));

    expect(body).toContain('"@type":"MusicComposition"');
    // The escaping is jsonLd.test.ts's to pin; what is pinned here is that this
    // page hands the script an already-escaped body rather than a raw one.
    expect(body).not.toContain("<");
  });

  it("sends an id-form address to the slug, keeping the list it was read from", async () => {
    // The whole point of the parameter surviving: dropped, the reader lands on
    // the song with no list bar, no swipe and no arrow keys, and nothing on
    // screen saying why.
    await expect(SongPage(props(UUID, { list: "list-1" }))).rejects.toThrow(
      new Redirected(`/songs/${SLUG}?list=list-1`),
    );
  });

  it("serves the app rather than redirecting when the song cannot be read", async () => {
    server.use(http.get(`${API}/api/v1/songs/:ref`, () => HttpResponse.error()));

    // Both halves matter. No redirect, because the slug is not known — and the
    // page still returns a tree, which is the client's own "not available"
    // getting its chance rather than a 404 for a song that exists behind an API
    // having a bad minute.
    const tree = await SongPage(props(UUID, { list: "list-1" }));

    expect(structuredData(tree)).toBeNull();
    expect(await generateMetadata(props(UUID))).toEqual({});
  });

  it("refuses a song carrying no address rather than redirecting to one", async () => {
    // What an API predating migration 000010 answers: the field is not there at
    // all, which `Song` cannot express and the compiler cannot catch. Left
    // alone, `songHref` builds `/songs/undefined` — and this is a *permanent*
    // redirect to it, with a canonical naming it that a search index keeps long
    // after the skew heals. Observed live against a stale local `make api`.
    server.use(servingSong(makeSong({ id: UUID, slug: undefined })));

    const tree = await SongPage(props(UUID));

    expect(structuredData(tree)).toBeNull();
    expect(await generateMetadata(props(UUID))).toEqual({});
  });
});
