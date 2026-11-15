// @vitest-environment node
import type { DehydratedState } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/api/hooks";

import { API, apiError, makeSong, makeUnaddressedSong, songByRef } from "@/test/handlers";
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

  it("hands the app the song it read, under its address and stamped stale", async () => {
    const tree = await SongPage(props(SLUG));

    const app = child<{ dehydratedState?: DehydratedState }>(tree, ClientOnly);
    const entries = app?.props.dehydratedState?.queries ?? [];
    expect(entries).toHaveLength(1);
    const [{ queryKey, state }] = entries as [DehydratedState["queries"][number]];
    // Keyed as `useSong` keys it: the address, not the id.
    expect(queryKey).toEqual(keys.song(SLUG));
    expect((state.data as { id: string }).id).toBe(UUID);
    // The read may be minutes old, so the app must refetch it at once.
    expect(state.dataUpdatedAt).toBe(0);
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

    expect(child(tree, ClientOnly)).toBeDefined();
  });

  it("serves the app rather than redirecting when the song cannot be read", async () => {
    server.use(http.get(`${API}/api/v1/songs/:ref`, () => HttpResponse.error()));

    // No redirect (the slug is unknown) and no 404: the client renders its own state.
    const tree = await SongPage(props(UUID, { list: "list-1" }));

    expect(structuredData(tree)).toBeNull();
    expect(child(tree, UntilAppMounts)).toBeUndefined();
    expect(
      child<{ dehydratedState?: unknown }>(tree, ClientOnly)?.props.dehydratedState,
    ).toBeUndefined();
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
