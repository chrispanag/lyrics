// @vitest-environment node
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API, makeSong, makeUnaddressedSong, notFound } from "@/test/handlers";
import { server } from "@/test/server";

/*
 * Pins the route's wiring (the 308, the absent title, the JSON-LD); the helpers
 * have their own specs. The async component is called and its tree inspected:
 * `<ClientOnly/>` renders nothing outside a Next build.
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

vi.mock("next/navigation", () => ({
  // The real one throws too, which is what stops the render.
  permanentRedirect: (location: string) => {
    throw new Redirected(location);
  },
}));

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

/** The JSON-LD script's body, or null when the page rendered no script at all. */
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

    // A metadata title would win `document.title` and never change again.
    expect(metadata).not.toHaveProperty("title");
    expect(metadata.openGraph?.title).toBe("Θάλασσα Πλατιά");
    expect(metadata.alternates?.canonical).toBe(`/songs/${SLUG}`);
    // A route's openGraph replaces the layout's, so these must be restated.
    expect(metadata.openGraph).toMatchObject({ siteName: "Songfolio" });
    expect(metadata.openGraph?.images).toBeDefined();
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

  it("serves the app rather than redirecting when the song cannot be read", async () => {
    server.use(http.get(`${API}/api/v1/songs/:ref`, () => HttpResponse.error()));

    // No redirect (the slug is unknown) and no 404: the client renders its own state.
    const tree = await SongPage(props(UUID, { list: "list-1" }));

    expect(structuredData(tree)).toBeNull();
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
