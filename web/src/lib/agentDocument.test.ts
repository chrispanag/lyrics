import { afterEach, describe, expect, it, vi } from "vitest";

import { makeList, makeSong } from "@/test/handlers";

import { homeMarkdown, markdownFor, notFoundMarkdown } from "./agentDocument";
import { CATALOG_ABOUT } from "./catalogCopy";

afterEach(() => vi.unstubAllGlobals());

describe("homeMarkdown", () => {
  it("is the catalog, with a way to the machine-readable files", () => {
    const { status, body } = homeMarkdown();

    expect(status).toBe(200);
    expect(body.startsWith("# Greek and English song lyrics")).toBe(true);
    expect(body).toContain(CATALOG_ABOUT[0]);
    expect(body).toContain("https://songfolio.live/llms.txt");
    expect(body).toContain("https://songfolio.live/sitemap.xml");
    expect(body).toContain("https://songfolio.live/openapi.json");
    expect(body.length).toBeGreaterThanOrEqual(500);
  });
});

describe("notFoundMarkdown", () => {
  it("explains the miss and links to the guide, the sitemap, and the spec", () => {
    const { status, body } = notFoundMarkdown("/__ora-404-probe");

    expect(status).toBe(404);
    expect(body.length).toBeGreaterThanOrEqual(20);
    expect(body).toContain("`/__ora-404-probe`");
    expect(body).toContain("https://songfolio.live/llms.txt");
    expect(body).toContain("https://songfolio.live/sitemap.xml");
    expect(body).toContain("https://songfolio.live/openapi.json");
  });

  it("does not echo a path that could break the document", () => {
    const { body } = notFoundMarkdown("/a`b\n<script>");

    expect(body).not.toContain("`b");
    expect(body).toContain("`/ab<script>`");
    expect(notFoundMarkdown("missing").body).toContain("`/missing`");
  });
});

describe("markdownFor", () => {
  it("returns the homepage and a real screen without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect((await markdownFor("/")).status).toBe(200);
    expect((await markdownFor("/login")).body).toContain("# Sign in");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a song the API returns, including its lyrics", async () => {
    const song = makeSong();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(song)),
    );

    const document = await markdownFor(`/songs/${song.slug}`);

    expect(document.status).toBe(200);
    expect(document.body).toContain(`# ${song.title}`);
    expect(document.body).toContain("Στης θάλασσας τα βάθη");
    expect(document.body).toContain(`https://songfolio.live/songs/${song.slug}`);
  });

  it("answers 404 when the API says the song does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    expect(await markdownFor("/songs/no-such-song")).toEqual(
      notFoundMarkdown("/songs/no-such-song"),
    );
  });

  it("does not claim a song is missing when the API cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );

    const document = await markdownFor("/songs/thalassa");

    expect(document.status).toBe(200);
    expect(document.body).toContain("could not be read");
  });

  it("renders a public list's songs as links", async () => {
    const list = makeList({
      id: "list-1",
      name: "Summer",
      songs: [makeSong({ slug: "first", title: "First" })],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(list)),
    );

    const document = await markdownFor("/lists/list-1");

    expect(document.status).toBe(200);
    expect(document.body).toContain("# Summer");
    expect(document.body).toContain("https://songfolio.live/songs/first");
  });

  it("404s an address no screen owns", async () => {
    expect((await markdownFor("/__ora-404-probe")).status).toBe(404);
  });

  it("describes the editor without fetching, and a list the API does not know", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    expect((await markdownFor("/songs/thalassa/edit")).body).toContain("# Edit song");
    expect((await markdownFor("/lists/missing")).status).toBe(404);
  });

  it("keeps a song's address when the API answers with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    const document = await markdownFor("/songs/thalassa");

    expect(document.status).toBe(200);
    expect(document.body).toContain("could not be read");
  });
});
