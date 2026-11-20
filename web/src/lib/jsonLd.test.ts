import { describe, expect, it, vi } from "vitest";

import { makeList, makeRecording, makeSong } from "@/test/handlers";

import { applicationJsonLd, listJsonLd, songJsonLd, websiteJsonLd } from "./jsonLd";

// A hostile site name, so the WebSite case can show its escaping: the real one
// has no `<` in it, and a constant is exactly what a later edit makes not one.
vi.mock("./site", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./site")>()),
  SITE_NAME: "Songfolio</script><script>alert(1)</script>",
}));

/*
 * The first case is a stored-XSS test: a lyric must not close the script tag.
 * The rest pin the shape a crawler reads, which nothing in the app renders.
 */

const ADDRESS = "https://songfolio.live/songs/thalassa-platia";

/** The object a crawler would parse, which is what every assertion below is about. */
function parsed(...args: Parameters<typeof songJsonLd>) {
  return JSON.parse(songJsonLd(...args));
}

describe("songJsonLd", () => {
  it("leaves no character in the script body that could close it", () => {
    const song = makeSong({
      title: "</script><img src=x onerror=alert(1)>",
      lyrics: "first line\n</SCRIPT >\n<!--\nlast line",
    });

    const body = songJsonLd(song, ADDRESS);

    // No `<` at all, so no tag can be closed and no comment opened.
    expect(body).not.toContain("<");
    expect(body).toContain("\\u003c");
    // A JSON escape, not a mangling: the text round-trips.
    expect(parsed(song, ADDRESS).lyrics.text).toBe(song.lyrics);
    expect(parsed(song, ADDRESS).name).toBe(song.title);
  });

  it("describes the work, its address and its language", () => {
    const song = makeSong();

    expect(parsed(song, ADDRESS)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "MusicComposition",
      name: song.title,
      url: ADDRESS,
      inLanguage: "el",
      composer: [{ "@type": "Person", name: "Μίκης Θεοδωράκης" }],
      lyrics: { "@type": "CreativeWork", text: song.lyrics },
    });
  });

  it("names each recording, its performers, its year and its video", () => {
    const song = makeSong({
      recordings: [
        makeRecording({
          label: "Live at Herodion",
          release_year: 1977,
          youtube_video_id: "dQw4w9WgXcQ",
        }),
      ],
    });

    expect(parsed(song, ADDRESS).recordedAs).toEqual([
      {
        "@type": "MusicRecording",
        // A MusicRecording needs a name, and a label is not one.
        name: song.title,
        alternateName: "Live at Herodion",
        byArtist: [{ "@type": "Person", name: "Γιώργος Νταλάρας" }],
        datePublished: "1977",
        // Built from the id, never from `youtube_url`.
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
    ]);
  });

  it("omits what a song does not have rather than claiming it is empty", () => {
    const bare = makeSong({ credits: [], recordings: [], lyrics: "" });

    const data = parsed(bare, ADDRESS);

    // Empty would be a positive claim (nobody wrote it, lyrics are blank).
    expect(data).not.toHaveProperty("composer");
    expect(data).not.toHaveProperty("lyricist");
    expect(data).not.toHaveProperty("recordedAs");
    expect(data).not.toHaveProperty("lyrics");
  });
});

describe("listJsonLd", () => {
  const ORIGIN = "https://songfolio.live";

  it("leaves no character in the script body that could close it", () => {
    const list = makeList({
      name: "</script><img src=x onerror=alert(1)>",
      description: "<!-- owner text",
      songs: [makeSong({ title: "</SCRIPT >" })],
    });

    const body = listJsonLd(list, ORIGIN);

    expect(body).not.toContain("<");
    // A JSON escape, not a mangling: the text round-trips.
    expect(JSON.parse(body).name).toBe(list.name);
    expect(JSON.parse(body).itemListElement[0].name).toBe("</SCRIPT >");
  });

  it("lists the songs in order, each by its canonical address", () => {
    const list = makeList({
      id: "list-9",
      songs: [makeSong({ slug: "first", title: "A" }), makeSong({ slug: "second", title: "B" })],
    });

    expect(JSON.parse(listJsonLd(list, ORIGIN))).toEqual({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: list.name,
      url: `${ORIGIN}/lists/list-9`,
      numberOfItems: 2,
      itemListElement: [
        { "@type": "ListItem", position: 1, url: `${ORIGIN}/songs/first`, name: "A" },
        { "@type": "ListItem", position: 2, url: `${ORIGIN}/songs/second`, name: "B" },
      ],
    });
  });
});

describe("applicationJsonLd", () => {
  it("identifies the product, escaped like every script body", () => {
    const body = applicationJsonLd();

    expect(body).not.toContain("<");
    expect(JSON.parse(body)).toMatchObject({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Songfolio</script><script>alert(1)</script>",
      url: "https://songfolio.live/",
      applicationCategory: "EntertainmentApplication",
      operatingSystem: "Web",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      author: {
        "@type": "Organization",
        name: "Songfolio</script><script>alert(1)</script>",
        url: "https://songfolio.live/",
      },
    });
  });
});

describe("websiteJsonLd", () => {
  it("names the site at its home, escaped like every script body", () => {
    const body = websiteJsonLd();

    expect(body).not.toContain("<");
    expect(JSON.parse(body)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Songfolio</script><script>alert(1)</script>",
      // Absolute, and the home page's own address: what Google reads the
      // site name from.
      url: "https://songfolio.live/",
      inLanguage: ["el", "en"],
    });
  });
});
