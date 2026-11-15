// @vitest-environment node
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { API, list, makeSong } from "@/test/handlers";
import { server } from "@/test/server";

import sitemap from "./sitemap";

/*
 * The crawlable index, which nothing in the app renders and so nothing else
 * would notice being wrong.
 *
 * `@vitest-environment node`, and not only for tidiness: this module runs in the
 * Node process and reaches the API through `api/client.ts`'s *server* branch,
 * which is the branch a jsdom spec would never take. Running it here is what
 * says the server-side origin resolution works at all.
 *
 * The three cases are the three ways this fails quietly. A walk that stops after
 * one page indexes the first hundred songs of nine hundred and looks complete; a
 * failure that propagates is a 500 to the one reader this route has, and — if the
 * forcing config ever stops applying — a build that fails on an API being down;
 * and a partial result would be the truncation of the first case wearing the
 * second's clothes.
 */

const ORIGIN = "https://songfolio.live";

/**
 * A page of the catalog, answered from a numbered set as `sort=oldest` would.
 *
 * `failFrom` is which request onwards to fail, counting from zero — the walk's
 * later pages are what a partial failure means, and describing a catalog page in
 * two places is how the second description drifts from the first.
 */
function catalogOf(total: number, failFrom = Infinity) {
  let asked = 0;
  return http.get(`${API}/api/v1/songs`, ({ request }) => {
    if (asked++ >= failFrom) return HttpResponse.error();

    const query = new URL(request.url).searchParams;
    // The parameters the walk depends on. Asserted here rather than in a case of
    // its own, because a walk that asked for the default page size or the
    // default sort would still return every song today and start losing them the
    // day the catalog outgrows one page.
    expect(query.get("limit")).toBe("100");
    expect(query.get("sort")).toBe("oldest");

    const offset = Number(query.get("offset"));
    const songs = Array.from({ length: Math.min(100, total - offset) }, (_, index) =>
      makeSong({ slug: `song-${offset + index}`, updated_at: "2024-05-05T00:00:00Z" }),
    );
    return HttpResponse.json(list(songs, { total, offset, limit: 100 }));
  });
}

describe("sitemap", () => {
  it("lists the catalog's own address and every song's", async () => {
    server.use(catalogOf(1));

    expect(await sitemap()).toEqual([
      { url: `${ORIGIN}/` },
      { url: `${ORIGIN}/songs/song-0`, lastModified: "2024-05-05T00:00:00Z" },
    ]);
  });

  it("walks past the first page rather than stopping at the API's limit", async () => {
    server.use(catalogOf(250));

    const entries = await sitemap();

    // Every song, in order, and each one once: the point of `sort=oldest` is
    // that paging cannot shuffle a row across a page boundary and hand back a
    // duplicate while dropping another.
    expect(entries).toHaveLength(251);
    expect(entries.at(-1)).toEqual({
      url: `${ORIGIN}/songs/song-249`,
      lastModified: "2024-05-05T00:00:00Z",
    });
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(251);
  });

  it("answers with the static routes alone when the API cannot be reached", async () => {
    server.use(http.get(`${API}/api/v1/songs`, () => HttpResponse.error()));

    await expectStaticRoutesOnly();
  });

  it("keeps nothing from a walk that failed part-way", async () => {
    // The first page arrives and the rest do not, so a version that returned
    // what it had would answer with a hundred songs of two hundred and fifty and
    // nothing at all to say the other hundred and fifty were missing.
    server.use(catalogOf(250, 1));

    await expectStaticRoutesOnly();
  });

  it("refuses a catalog whose songs carry no address", async () => {
    // What an API predating migration 000010 answers: the field is not there at
    // all rather than empty, which `Song` cannot express and so the compiler
    // cannot catch. `songHref` then builds `/songs/undefined`, and the sitemap
    // that used to come out of this was that one dead address repeated once per
    // song — a shape a filter would turn into "a catalog of no songs", which
    // reads exactly like success.
    server.use(
      http.get(`${API}/api/v1/songs`, () =>
        HttpResponse.json(list([makeSong({ slug: undefined })])),
      ),
    );

    await expectStaticRoutesOnly();
  });
});

/**
 * The whole of what a failed walk may produce: the static routes, and a logged
 * cause.
 *
 * The log is asserted rather than merely tolerated because it is the only report
 * this route has — a sitemap of one URL is a green deploy otherwise. Silenced
 * with a spy for the reason `AuthPages.test.tsx` gives at its own: the suite
 * prints no stderr, and three deliberate failures dumping a stack each would
 * bury a real one. Restored from a `finally`, so a failing assertion cannot
 * leave `console.error` mocked for every spec after it.
 */
async function expectStaticRoutesOnly() {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await sitemap()).toEqual([{ url: `${ORIGIN}/` }]);
    expect(logged).toHaveBeenCalled();
  } finally {
    logged.mockRestore();
  }
}
