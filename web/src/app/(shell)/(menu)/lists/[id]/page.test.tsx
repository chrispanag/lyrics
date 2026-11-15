// @vitest-environment node
import { type DehydratedState, HydrationBoundary } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/api/hooks";
import { RouteParams } from "@/lib/navigation";
import { catalogList, catalogSongs } from "@/test/catalog";
import { API, apiError, listById, makeUnaddressedSong } from "@/test/handlers";
import { server } from "@/test/server";
import { TestProviders } from "@/test/TestProviders";

/*
 * Pins the route's wiring: what a guest's read of a list hands the page and
 * tells a crawler, and above all that a list the guest cannot read is never
 * described. The async component is called and its tree inspected, then
 * rendered to a string the way the server sends it. Under Node: server code.
 */

const PUBLIC_ID = "5b2f1c0e-1d3a-4e7b-9c4d-2a1f0e3b4c5d";
const PRIVATE_ID = "6c3a2d1f-2e4b-4f8c-8d5e-3b2a1f4c5d6e";
const SECRET = "Μυστική λίστα";

/** What `notFound` would throw, so a spec can say it was never called. */
class NotFound extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
}));

const { default: ListPage, generateMetadata } = await import("./page");
const { ListDetailPage } = await import("@/routes/ListsPages");

const publicList = catalogList(2, {
  id: PUBLIC_ID,
  name: "Καλοκαιρινά",
  description: "Songs for August",
});

const props = (id: string) => ({ params: Promise.resolve({ id }) });

/** The page's top-level elements, a `false` from each `&&` left out. */
function topLevel(tree: ReactElement): ReactElement<Record<string, unknown>>[] {
  return (tree.props as { children: unknown[] }).children.flat().filter(Boolean) as ReactElement<
    Record<string, unknown>
  >[];
}

function structuredData(tree: ReactElement): string | null {
  const script = topLevel(tree).find((node) => node.props.type === "application/ld+json");
  const inner = script?.props.dangerouslySetInnerHTML as { __html: string } | undefined;
  return inner?.__html ?? null;
}

function boundary(tree: ReactElement) {
  return topLevel(tree).find((node) => node.type === HydrationBoundary) as
    | ReactElement<{ children: ReactElement; state?: DehydratedState }>
    | undefined;
}

/** The document a server would send for `tree`, as a guest. */
function html(tree: ReactElement, id: string): string {
  return renderToString(
    <TestProviders route={`/lists/${id}`}>
      <RouteParams params={{ id }}>{tree}</RouteParams>
    </TestProviders>,
  );
}

// `listById` answers any id it was not given as the API answers a private
// list to a guest: the `not_found` envelope.
beforeEach(() => server.use(listById(publicList)));

describe("a public list's server-rendered document", () => {
  it("hands the page the list, keyed as `useList` keys it", async () => {
    const tree = await ListPage(props(PUBLIC_ID));

    const found = boundary(tree);
    expect(found?.props.children.type).toBe(ListDetailPage);
    const entries = found?.props.state?.queries ?? [];
    expect(entries).toHaveLength(1);
    const [{ queryKey, state }] = entries as [DehydratedState["queries"][number]];
    expect(queryKey).toEqual(keys.list(PUBLIC_ID));
    expect((state.data as { name: string }).name).toBe("Καλοκαιρινά");
    // Read uncached, so fresh: a shared link costs its reader no second request.
    expect(state.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("sends the list's name, its songs and the tab's title in the HTML", async () => {
    const page = html(await ListPage(props(PUBLIC_ID)), PUBLIC_ID);

    expect(page).toContain("<title>Καλοκαιρινά — Songfolio</title>");
    expect(page).toMatch(/<h1[^>]*>Καλοκαιρινά<\/h1>/);
    for (const song of catalogSongs.slice(0, 2)) expect(page).toContain(song.title);
  });

  it("describes the list for a link preview without ever naming a title", async () => {
    const metadata = await generateMetadata(props(PUBLIC_ID));

    // A metadata title would win `document.title` and never change again.
    expect(metadata).not.toHaveProperty("title");
    expect(metadata.description).toBe("Songs for August — a list of 2 songs.");
    expect(metadata.alternates?.canonical).toBe(`/lists/${PUBLIC_ID}`);
    expect(metadata.openGraph).toMatchObject({ title: "Καλοκαιρινά", siteName: "Songfolio" });
    expect(metadata.openGraph?.images).toBeDefined();
    expect(metadata).not.toHaveProperty("robots");
  });

  it("lists its songs by their canonical addresses, escaped", async () => {
    server.use(listById({ ...publicList, name: "</script><img src=x>" }));

    const body = structuredData(await ListPage(props(PUBLIC_ID)));

    // jsonLd.test.ts pins the shape; this pins that the page uses the escaping.
    expect(body).not.toContain("<");
    expect(JSON.parse(body ?? "null")).toMatchObject({
      "@type": "ItemList",
      itemListElement: [
        { position: 1, url: `https://songfolio.live/songs/${catalogSongs[0]?.slug}` },
        { position: 2, url: `https://songfolio.live/songs/${catalogSongs[1]?.slug}` },
      ],
    });
  });
});

describe("a list a guest cannot read", () => {
  // Private and deleted answer alike, so nothing may 404: that would 404 an
  // owner's private list on every load, before their session could ask.
  it("renders the page with nothing about the list, and no 404", async () => {
    const tree = await ListPage(props(PRIVATE_ID));

    expect(structuredData(tree)).toBeNull();
    const found = boundary(tree);
    expect(found?.props.children.type).toBe(ListDetailPage);
    expect(found?.props.state).toBeUndefined();
    expect(html(tree, PRIVATE_ID)).not.toContain(SECRET);
  });

  it("says nothing about itself in its metadata, and asks not to be indexed", async () => {
    const metadata = await generateMetadata(props(PRIVATE_ID));

    expect(metadata).toEqual({ robots: { index: false } });
  });

  it("is refused alike when the address is no list's id at all", async () => {
    server.use(
      http.get(`${API}/api/v1/lists/:id`, () =>
        apiError(400, "bad_request", '"x" is not a valid identifier.'),
      ),
    );

    expect(await generateMetadata(props("x"))).toEqual({ robots: { index: false } });
  });

  // The guarantee rests on the read being a guest's whoever asks, so it is
  // pinned at the request: no token may reach it, even with one on offer.
  it("asks as a guest, so an owner's token cannot put their list in the HTML", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}/api/v1/lists/:id`, ({ request }) => {
        seen.push(request.headers.get("Authorization"));
        return request.headers.get("Authorization")
          ? HttpResponse.json(catalogList(1, { id: PRIVATE_ID, name: SECRET, is_public: false }))
          : apiError(404, "not_found", "List was not found.");
      }),
    );
    const { setTokenProvider } = await import("@/api/client");
    setTokenProvider(async () => "owner-token");

    try {
      const tree = await ListPage(props(PRIVATE_ID));
      expect(boundary(tree)?.props.state).toBeUndefined();
      expect(await generateMetadata(props(`${PRIVATE_ID}`))).toEqual({ robots: { index: false } });
    } finally {
      setTokenProvider(async () => null);
    }
    expect(seen).not.toHaveLength(0);
    expect(seen.every((header) => header === null)).toBe(true);
  });
});

describe("a list the API could not be asked about", () => {
  it.each([
    ["a network failure", () => HttpResponse.error()],
    [
      "a bare 404 from something in front of the API",
      () => new HttpResponse(null, { status: 404 }),
    ],
    ["a 500", () => apiError(500, "internal", "Something went wrong.")],
  ])("serves the page on %s, claiming nothing", async (_, answer) => {
    server.use(http.get(`${API}/api/v1/lists/:id`, answer));

    const tree = await ListPage(props(PUBLIC_ID));

    expect(boundary(tree)?.props.state).toBeUndefined();
    // Not `noindex`: an outage must not drop a public list from an index.
    expect(await generateMetadata(props(PUBLIC_ID))).toEqual({});
  });

  it("refuses a list whose songs carry no address", async () => {
    // An API older than migration 000010: every row would link to /songs/undefined.
    server.use(listById({ ...publicList, songs: [makeUnaddressedSong()] }));

    const tree = await ListPage(props(PUBLIC_ID));

    expect(structuredData(tree)).toBeNull();
    expect(await generateMetadata(props(PUBLIC_ID))).toEqual({});
  });
});
