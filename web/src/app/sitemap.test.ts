// @vitest-environment node
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { API, list, makeSong } from "@/test/handlers";
import { server } from "@/test/server";

import sitemap from "./sitemap";

// The node environment exercises `api/client.ts`'s server branch, which jsdom
// never takes.

const ORIGIN = "https://songfolio.live";

/**
 * A page of the catalog, answered as `sort=oldest` would. `failFrom` is the
 * zero-based request from which every request fails.
 */
function catalogOf(total: number, failFrom = Infinity) {
  let asked = 0;
  return http.get(`${API}/api/v1/songs`, ({ request }) => {
    if (asked++ >= failFrom) return HttpResponse.error();

    const query = new URL(request.url).searchParams;
    // Asserted on every request: wrong values pass until the catalog outgrows a page.
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

    // Every song, in order, and each one once.
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
    // The first page arrives and the rest fail; a partial sitemap must not ship.
    server.use(catalogOf(250, 1));

    await expectStaticRoutesOnly();
  });

  it("refuses a catalog whose songs carry no address", async () => {
    // An API older than migration 000010 omits the field; `songHref` would
    // build `/songs/undefined` for every song.
    server.use(
      http.get(`${API}/api/v1/songs`, () =>
        HttpResponse.json(list([makeSong({ slug: undefined })])),
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
  try {
    expect(await sitemap()).toEqual([{ url: `${ORIGIN}/` }]);
    expect(logged).toHaveBeenCalled();
  } finally {
    logged.mockRestore();
  }
}
