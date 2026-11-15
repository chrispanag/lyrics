// @vitest-environment node
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { API, makeSong, makeUnaddressedSong, songByRef } from "@/test/handlers";
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
const { ClientOnly } = await import("@/app/client");
const { UntilAppMounts } = await import("@/app/UntilAppMounts");
const { SongPreview } = await import("./SongPreview");

/** Answers the song at both of its addresses, and 404s anything else. */
function servingSong(song = makeSong({ id: UUID, slug: SLUG })) {
  return songByRef(song);
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

/** The page's top-level element of a given component, if it rendered one. */
function child<P>(tree: ReactElement, type: unknown): ReactElement<P> | undefined {
  const children = (tree.props as { children: unknown[] }).children;
  return children.flat().find((node) => (node as ReactElement | null)?.type === type) as
    | ReactElement<P>
    | undefined;
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

  it("renders the song for readers without JavaScript, until the app takes over", async () => {
    const tree = await SongPage(props(SLUG));

    // Inside the boundary that unmounts it, or its <title> outlives the app's.
    const standIn = child<{ children: ReactElement<{ song: { slug: string } }> }>(
      tree,
      UntilAppMounts,
    );
    expect(standIn?.props.children.type).toBe(SongPreview);
    expect(standIn?.props.children.props.song.slug).toBe(SLUG);
  });

  it("hands the app the song it read, under the address it was read at", async () => {
    const tree = await SongPage(props(SLUG));

    // Keyed as `useSong` keys it: the address, not the id.
    const app = child<{ seeded?: { ref: string; song: { id: string } } }>(tree, ClientOnly);
    expect(app?.props.seeded?.ref).toBe(SLUG);
    expect(app?.props.seeded?.song.id).toBe(UUID);
  });

  it("answers 404 when the API says no such song exists", async () => {
    await expect(SongPage(props("no-such-song"))).rejects.toThrow(NotFound);
    expect(await generateMetadata(props("no-such-song"))).toEqual({});
  });

  it("does not 404 on a bare 404 from something in front of the API", async () => {
    // A misrouted ingress answers 404 for every song; that must not deindex them.
    server.use(
      http.get(`${API}/api/v1/songs/:ref`, () => new HttpResponse("Not Found", { status: 404 })),
    );

    const tree = await SongPage(props(SLUG));

    expect(child(tree, ClientOnly)).toBeDefined();
  });

  it("serves the app rather than redirecting when the song cannot be read", async () => {
    server.use(http.get(`${API}/api/v1/songs/:ref`, () => HttpResponse.error()));

    // No redirect (the slug is unknown) and no 404: the client renders its own state.
    const tree = await SongPage(props(UUID, { list: "list-1" }));

    expect(structuredData(tree)).toBeNull();
    expect(child(tree, UntilAppMounts)).toBeUndefined();
    expect(child<{ seeded?: unknown }>(tree, ClientOnly)?.props.seeded).toBeUndefined();
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
