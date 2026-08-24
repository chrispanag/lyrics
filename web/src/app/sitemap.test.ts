// @vitest-environment node
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

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

/** A page of the catalog, answered from a numbered set as `sort=oldest` would. */
function catalogOf(total: number) {
  return http.get(`${API}/api/v1/songs`, ({ request }) => {
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

    expect(await sitemap()).toEqual([{ url: `${ORIGIN}/` }]);
  });

  it("keeps nothing from a walk that failed part-way", async () => {
    // The second request fails, so a version that returned what it had would
    // answer with the first hundred songs and no sign that eight hundred were
    // missing.
    let asked = 0;
    server.use(
      http.get(`${API}/api/v1/songs`, ({ request }) => {
        if (asked++ > 0) return HttpResponse.error();
        const offset = Number(new URL(request.url).searchParams.get("offset"));
        const songs = Array.from({ length: 100 }, (_, index) =>
          makeSong({ slug: `song-${offset + index}` }),
        );
        return HttpResponse.json(list(songs, { total: 250, offset, limit: 100 }));
      }),
    );

    expect(await sitemap()).toEqual([{ url: `${ORIGIN}/` }]);
  });
});
