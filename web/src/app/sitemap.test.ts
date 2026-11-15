// @vitest-environment node
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicList } from "@/lib/types";
import { API, list, makeSong, makeUnaddressedSong } from "@/test/handlers";
import { server } from "@/test/server";

import sitemap from "./sitemap";

// The node environment exercises `api/client.ts`'s server branch, which jsdom
// never takes.

const ORIGIN = "https://songfolio.live";

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

// No public lists unless a case says otherwise.
beforeEach(() => server.use(publicListsOf(0)));

describe("sitemap", () => {
  it("lists the catalog's own address, every song's and every public list's", async () => {
    server.use(catalogOf(1), publicListsOf(1));

    expect(await sitemap()).toEqual([
      { url: `${ORIGIN}/` },
      { url: `${ORIGIN}/songs/song-0`, lastModified: "2024-05-05T00:00:00Z" },
      { url: `${ORIGIN}/lists/list-0`, lastModified: "2024-06-06T00:00:00Z" },
    ]);
  });

  it("walks past the first page rather than stopping at the API's limit", async () => {
    server.use(catalogOf(250), publicListsOf(150));

    const entries = await sitemap();

    // Every song and list, in order, and each one once.
    expect(entries).toHaveLength(401);
    expect(entries[250]).toEqual({
      url: `${ORIGIN}/songs/song-249`,
      lastModified: "2024-05-05T00:00:00Z",
    });
    expect(entries.at(-1)).toEqual({
      url: `${ORIGIN}/lists/list-149`,
      lastModified: "2024-06-06T00:00:00Z",
    });
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(401);
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

  it("refuses a catalog whose songs carry no address", async () => {
    // An API older than migration 000010 omits the field; `songHref` would
    // build `/songs/undefined` for every song.
    server.use(
      http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list([makeUnaddressedSong()]))),
    );

    await expectStaticRoutesOnly();
  });

  it("refuses a public list carrying no id", async () => {
    server.use(
      catalogOf(1),
      http.get(`${API}/api/v1/public-lists`, () =>
        HttpResponse.json(list([{ updated_at: "2024-06-06T00:00:00Z" }])),
      ),
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
