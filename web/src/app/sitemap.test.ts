// @vitest-environment node
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CreditedPerson, Genre, PublicList } from "@/lib/types";
import { API, list, makeGenre, makePerson, makeSong, makeUnaddressedSong } from "@/test/handlers";
import { server } from "@/test/server";

import { generateMetadata } from "./(shell)/page";
import sitemap from "./sitemap";

// The node environment exercises `api/client.ts`'s server branch, which jsdom
// never takes.

const ORIGIN = "https://songfolio.live";

/** A person id as the API answers with one: lower case, dashed. */
const personId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/**
 * A paginated collection answered as the API would, oldest first. `failFrom`
 * is the zero-based request from which every request fails. Asserts the limit
 * on every request: a wrong one passes until a collection outgrows a page.
 */
function walkOf<T>(
  path: string,
  total: number,
  row: (index: number) => T,
  failFrom: number,
  sort: string | null = null,
) {
  let asked = 0;
  return http.get(`${API}${path}`, ({ request }) => {
    if (asked++ >= failFrom) return HttpResponse.error();

    const query = new URL(request.url).searchParams;
    expect(query.get("limit")).toBe("100");
    expect(query.get("sort")).toBe(sort);

    const offset = Number(query.get("offset"));
    const rows = Array.from({ length: Math.min(100, total - offset) }, (_, index) =>
      row(offset + index),
    );
    return HttpResponse.json(list(rows, { total, offset, limit: 100 }));
  });
}

function catalogOf(total: number, failFrom = Infinity) {
  return walkOf(
    "/api/v1/songs",
    total,
    (index) => makeSong({ slug: `song-${index}`, updated_at: "2024-05-05T00:00:00Z" }),
    failFrom,
    "oldest",
  );
}

function publicListsOf(total: number, failFrom = Infinity) {
  return walkOf<PublicList>(
    "/api/v1/public-lists",
    total,
    (index) => ({ id: `list-${index}`, updated_at: "2024-06-06T00:00:00Z" }),
    failFrom,
  );
}

function creditedPeopleOf(total: number, failFrom = Infinity) {
  return walkOf<CreditedPerson>(
    "/api/v1/credited-people",
    total,
    (index) => ({ id: personId(index) }),
    failFrom,
  );
}

/** `/genres` as the API answers it: every genre at once, unpaginated. */
function genresOf(genres: Genre[]) {
  return http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list(genres)));
}

const rempetiko = makeGenre({ song_count: 4 });
const laiko = makeGenre({ id: "genre-2", name: "Λαϊκό", slug: "laiko", song_count: 1 });
const unsung = makeGenre({ id: "genre-3", name: "Κενό", slug: "keno", song_count: 0 });

// No people, genres or public lists unless a case says otherwise.
beforeEach(() => server.use(publicListsOf(0), creditedPeopleOf(0), genresOf([])));

describe("sitemap", () => {
  it("lists the catalog, each genre's and person's page, every song and every public list", async () => {
    server.use(catalogOf(1), publicListsOf(1), creditedPeopleOf(1), genresOf([rempetiko, unsung]));

    // The genre on no song is left out: its page is an empty catalog.
    expect(await sitemap()).toEqual([
      { url: `${ORIGIN}/` },
      { url: `${ORIGIN}/?genre_slug=rempetiko` },
      { url: `${ORIGIN}/?person=${personId(0)}` },
      { url: `${ORIGIN}/songs/song-0`, lastModified: "2024-05-05T00:00:00Z" },
      { url: `${ORIGIN}/lists/list-0`, lastModified: "2024-06-06T00:00:00Z" },
    ]);
  });

  // The two are built by one helper each, and this is what says they agree:
  // every catalog page listed is the address its own route names canonical,
  // not a duplicate of it, and not one the route marks noindex.
  it("lists each catalog page under the canonical its route declares", async () => {
    server.use(
      catalogOf(0),
      creditedPeopleOf(2),
      genresOf([rempetiko, laiko]),
      http.get(`${API}/api/v1/people/:id`, ({ params }) =>
        HttpResponse.json(makePerson({ id: String(params.id), song_count: 3 })),
      ),
    );

    const landing = (await sitemap()).slice(1);
    expect(landing).toHaveLength(4);

    for (const { url } of landing) {
      const metadata = await generateMetadata({
        searchParams: Promise.resolve(Object.fromEntries(new URL(url).searchParams)),
      });
      expect(`${ORIGIN}${metadata.alternates?.canonical}`).toBe(url);
      expect(metadata.robots).toBeUndefined();
    }
  });

  it("walks past the first page rather than stopping at the API's limit", async () => {
    server.use(catalogOf(250), publicListsOf(150), creditedPeopleOf(150));

    const entries = await sitemap();

    // Every person, song and list, in order, and each one once.
    expect(entries).toHaveLength(551);
    expect(entries[150]).toEqual({ url: `${ORIGIN}/?person=${personId(149)}` });
    expect(entries[400]).toEqual({
      url: `${ORIGIN}/songs/song-249`,
      lastModified: "2024-05-05T00:00:00Z",
    });
    expect(entries.at(-1)).toEqual({
      url: `${ORIGIN}/lists/list-149`,
      lastModified: "2024-06-06T00:00:00Z",
    });
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(551);
  });

  it("answers with the static routes alone when the API cannot be reached", async () => {
    server.use(http.get(`${API}/api/v1/songs`, () => HttpResponse.error()));

    await expectStaticRoutesOnly();
  });

  it("keeps nothing from a walk that failed part-way", async () => {
    // The first page arrives and the rest fail; a partial sitemap must not ship.
    server.use(catalogOf(250, 1));

    await expectStaticRoutesOnly();
  });

  // The songs all arrive, and still nothing ships: a sitemap with every song
  // and no list reads as a catalog with no public lists.
  it("keeps no songs when the lists' walk failed part-way", async () => {
    server.use(catalogOf(1), publicListsOf(150, 1));

    await expectStaticRoutesOnly();
  });

  // Every song and half the people reads as half the artists having no page.
  it("keeps no songs when the people's walk failed part-way", async () => {
    server.use(catalogOf(1), creditedPeopleOf(150, 1));

    await expectStaticRoutesOnly();
  });

  it("keeps no songs when the genres could not be read", async () => {
    server.use(
      catalogOf(1),
      http.get(`${API}/api/v1/genres`, () => HttpResponse.error()),
    );

    await expectStaticRoutesOnly();
  });

  it("refuses a catalog whose songs carry no address", async () => {
    // An API older than migration 000010 omits the field; `songHref` would
    // build `/songs/undefined` for every song.
    server.use(
      http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list([makeUnaddressedSong()]))),
    );

    await expectStaticRoutesOnly();
  });

  // Filtered rather than refused, a genre with no count would read as one on
  // no song, and a payload without the field would quietly list no genres.
  it("refuses a genre it cannot tell is on a song", async () => {
    const { song_count: _, ...uncounted } = rempetiko;
    server.use(catalogOf(1), genresOf([uncounted]));

    await expectStaticRoutesOnly();
  });

  it("refuses a person with no id", async () => {
    server.use(
      catalogOf(1),
      http.get(`${API}/api/v1/credited-people`, () => HttpResponse.json(list([{}]))),
    );

    await expectStaticRoutesOnly();
  });
});

/**
 * A failed walk yields the static routes and a logged cause; the log is the
 * route's only report, so it is asserted (and silenced).
 */
async function expectStaticRoutesOnly() {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await sitemap()).toEqual([{ url: `${ORIGIN}/` }]);
  expect(logged).toHaveBeenCalled();
}
