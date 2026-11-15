// @vitest-environment node
import { HttpResponse, http } from "msw";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/api/hooks";
import { BrowsePage } from "@/routes/BrowsePage";
import { catalogGenres, catalogSongs } from "@/test/catalog";
import { API, apiError, list, makePerson, notFound } from "@/test/handlers";
import { server } from "@/test/server";
import { hanging, shortenReadBudget } from "@/test/readBudget";
import { handover, structuredData } from "@/test/serverTree";
import { TestProviders } from "@/test/TestProviders";

import CatalogPage, { generateMetadata } from "./page";

/*
 * Pins the catalog route's wiring: the reads handed to the page under the keys
 * its hooks use, the page surviving an API that cannot answer, which views are
 * indexable and under what address, and the WebSite JSON-LD. The async
 * component is called and its tree inspected, then rendered to a string the
 * way the server sends it. Under Node: this module is server code.
 */

// A real id: the route asks the API about nothing else.
const PERSON = makePerson({ id: "a5ec6a45-541c-4b8f-b3a0-c8ac8aa57e81", song_count: 12 });

const props = (search: Record<string, string | string[]> = {}) => ({
  searchParams: Promise.resolve(search),
});

/** Each handed-over entry's key, beside its data and when it was read. */
function entries(tree: ReactElement) {
  return (handover(tree)?.props.state?.queries ?? []).map(({ queryKey, state }) => ({
    queryKey,
    data: state.data,
    updatedAt: state.dataUpdatedAt,
  }));
}

/** Renders the route's tree at an address, as the server sends it. */
async function html(search: Record<string, string>) {
  const tree = await CatalogPage(props(search));
  const route = `/?${new URLSearchParams(search)}`;
  return renderToString(<TestProviders route={route}>{tree}</TestProviders>);
}

afterEach(() => vi.restoreAllMocks());

beforeEach(() =>
  server.use(
    http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list(catalogSongs))),
    http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list(catalogGenres))),
    http.get(`${API}/api/v1/people/:id`, ({ params }) =>
      params.id === PERSON.id ? HttpResponse.json(PERSON) : notFound("Person not found."),
    ),
  ),
);

describe("the catalog's server render", () => {
  it("hands the page its reads, keyed as its hooks key them", async () => {
    const before = Date.now();
    const tree = await CatalogPage(
      props({ person: PERSON.id, page: "1", sort: "title", genre_slug: "rempetiko" }),
    );

    expect(handover(tree)?.props.children.type).toBe(BrowsePage);
    // Written out rather than derived: deriving it here would pass whatever
    // the route derived.
    expect(entries(tree).map((entry) => entry.queryKey)).toEqual(
      expect.arrayContaining([
        keys.songs({
          person: PERSON.id,
          genre_slug: "rempetiko",
          sort: "title",
          limit: 20,
          offset: 20,
        }),
        keys.genres(),
        keys.person(PERSON.id),
      ]),
    );
    expect(entries(tree)).toHaveLength(3);
    // Fresh reads, stamped as such, so the browser does not ask again on load.
    for (const entry of entries(tree)) expect(entry.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("asks for no person when the address names none", async () => {
    const tree = await CatalogPage(props({ q: "θάλασσα" }));

    expect(entries(tree).map((entry) => entry.queryKey)).toEqual([
      keys.songs({ q: "θάλασσα", sort: "relevance", limit: 20, offset: 0 }),
      keys.genres(),
    ]);
  });

  // What a crawler, an agent or a reader before any JavaScript gets: the songs
  // themselves, linked, and the view named — which only happens if the page's
  // hooks found the entries under the keys they were handed under.
  it("sends a person's songs, linked, under a title naming them", async () => {
    const page = await html({ person: PERSON.id });

    expect(page).toContain(`<title>Songs by ${PERSON.name} — Songfolio</title>`);
    for (const song of catalogSongs) {
      expect(page).toContain(song.title);
      expect(page).toContain(`href="/songs/${song.slug}"`);
    }
    // The chip names the person rather than standing in with "Artist".
    expect(page).toMatch(new RegExp(`>${PERSON.name}<`));
    expect(page).toContain("5 songs");
    expect(page).not.toContain("Searching…");
  });

  it("names a genre's view by the genre", async () => {
    expect(await html({ genre_slug: "rempetiko" })).toContain(
      "<title>Ρεμπέτικο songs — Songfolio</title>",
    );
  });

  it("names a search by its query", async () => {
    expect(await html({ q: "θάλασσα" })).toContain("<title>Search: θάλασσα — Songfolio</title>");
  });

  it("serves the page, with nothing handed over, when the API cannot answer", async () => {
    server.use(
      http.get(`${API}/api/v1/songs`, () => HttpResponse.error()),
      http.get(`${API}/api/v1/genres`, () => apiError(500, "internal", "Something broke.")),
      http.get(`${API}/api/v1/people/:id`, () => HttpResponse.error()),
    );

    const tree = await CatalogPage(props({ person: PERSON.id }));

    // The browser asks again and says so in its own words; never a 500 here.
    expect(handover(tree)?.props.children.type).toBe(BrowsePage);
    expect(entries(tree)).toEqual([]);
    // An outage is no reason to deindex the person's page.
    expect((await generateMetadata(props({ person: PERSON.id }))).alternates?.canonical).toBe(
      `/?person=${PERSON.id}`,
    );
  });

  it("gives up on an API that hangs rather than fails, within its budget", async () => {
    shortenReadBudget();
    server.use(hanging(`${API}/api/v1/songs`));

    const tree = await CatalogPage(props());

    // The songs read gave up and is not handed over; the genres still are.
    expect(entries(tree).map((entry) => entry.queryKey)).toEqual([keys.genres()]);
  });

  it("keeps an unread person's canonical in the one spelling the API answers with", async () => {
    server.use(http.get(`${API}/api/v1/people/:id`, () => HttpResponse.error()));
    const shouted = PERSON.id.toUpperCase().replaceAll("-", "");

    const metadata = await generateMetadata(props({ person: shouted }));

    expect(metadata.alternates?.canonical).toBe(`/?person=${PERSON.id}`);
  });

  it("describes the site as the WebSite a search engine names results by", async () => {
    const body = structuredData(await CatalogPage(props())) ?? "";

    expect(JSON.parse(body)).toMatchObject({ "@type": "WebSite", url: "https://songfolio.live/" });
    // jsonLd.test.ts pins the escaping; this pins that the page uses it.
    expect(body).not.toContain("<");
  });
});

describe("what the catalog tells a crawler", () => {
  const NOINDEX = { index: false, follow: true };

  it("is the canonical home, described as the site", async () => {
    const metadata = await generateMetadata(props());

    // A metadata title would win `document.title` and never change again.
    expect(metadata).not.toHaveProperty("title");
    expect(metadata).not.toHaveProperty("robots");
    expect(metadata.alternates?.canonical).toBe("/");
    // A route's openGraph replaces the layout's, so these must be restated.
    expect(metadata.openGraph).toMatchObject({
      siteName: "Songfolio",
      title: "Songfolio",
      url: "/",
    });
    expect(metadata.openGraph?.images).toBeDefined();
    expect(metadata.openGraph?.description).toMatch(/song lyrics catalog/);
  });

  it("makes a person's songs a page of their own, whatever the order", async () => {
    const metadata = await generateMetadata(props({ person: PERSON.id, sort: "title" }));

    expect(metadata).not.toHaveProperty("robots");
    // The sort is folded in: the same songs, reordered, are the same page.
    expect(metadata.alternates?.canonical).toBe(`/?person=${PERSON.id}`);
    expect(metadata.description).toBe(
      `Lyrics to 12 songs by ${PERSON.name}, written or performed.`,
    );
    expect(metadata.openGraph).toMatchObject({
      title: `Songs by ${PERSON.name}`,
      url: `/?person=${PERSON.id}`,
    });
  });

  it("makes a genre's songs a page of their own", async () => {
    const metadata = await generateMetadata(props({ genre_slug: "laiko" }));

    expect(metadata).not.toHaveProperty("robots");
    expect(metadata.alternates?.canonical).toBe("/?genre_slug=laiko");
    expect(metadata.openGraph?.title).toBe("Λαϊκό songs");
  });

  it.each([
    ["a search", { q: "θάλασσα" }],
    ["a later page", { page: "2" }],
    ["a later page of a person's songs", { person: PERSON.id, page: "1" }],
    ["a language", { language: "el" }],
    ["a combination of filters", { person: PERSON.id, genre_slug: "laiko" }],
    ["a person the API does not know", { person: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }],
    ["a person id the API could not parse", { person: "person-1" }],
    ["a genre the API does not know", { genre_slug: "no-such-genre" }],
  ])("keeps %s out of the index, without a canonical to contradict it", async (_, search) => {
    const metadata = await generateMetadata(props(search));

    expect(metadata.robots).toEqual(NOINDEX);
    expect(metadata).not.toHaveProperty("alternates");
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  it("does not take a person's id for a name it could not read", async () => {
    server.use(http.get(`${API}/api/v1/people/:id`, () => HttpResponse.error()));

    const metadata = await generateMetadata(props({ person: PERSON.id }));

    expect(metadata).not.toHaveProperty("description");
    expect(metadata.openGraph?.title).toBe("Songfolio");
  });
});
