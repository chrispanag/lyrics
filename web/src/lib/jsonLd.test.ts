import { describe, expect, it } from "vitest";

import { makeRecording, makeSong } from "@/test/handlers";

import { songJsonLd } from "./jsonLd";

/*
 * The structured description of a song, and above all the escaping in it.
 *
 * This is the app's only `dangerouslySetInnerHTML` carrying contributor-typed
 * text, so the first case is the one that matters: it is a stored-XSS test, and
 * the failure it names is a lyric that closes the script tag and turns the rest
 * of the document into markup a contributor wrote. The rest pin the shape a
 * crawler reads, where being wrong is invisible from inside the app — nothing in
 * the product renders any of this.
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

    // The literal test, and it is the whole point: with `<` escaped there is no
    // `<` left at all, so no tag can be closed and no comment opened — whatever
    // case, spacing or trailing junk the payload used.
    expect(body).not.toContain("<");
    expect(body).toContain("\\u003c");
    // And the escaping is a JSON escape rather than a mangling: the text the
    // crawler reads back is exactly what the contributor typed.
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
        // The song's title: a MusicRecording needs a name and a label is not
        // one.
        name: song.title,
        alternateName: "Live at Herodion",
        byArtist: [{ "@type": "Person", name: "Γιώργος Νταλάρας" }],
        datePublished: "1977",
        // Built from the id, never from `youtube_url` — the same rule
        // WatchOnYouTube keeps, and the reason both go through `watchUrl`.
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
    ]);
  });

  it("omits what a song does not have rather than claiming it is empty", () => {
    const bare = makeSong({ credits: [], recordings: [], lyrics: "" });

    const data = parsed(bare, ADDRESS);

    // An empty array is a positive claim that nobody wrote this song, and an
    // empty CreativeWork a claim that the lyrics are known to be blank. Both are
    // wrong about a catalog whose credits are mostly partial, and a crawler
    // reads them as stated.
    expect(data).not.toHaveProperty("composer");
    expect(data).not.toHaveProperty("lyricist");
    expect(data).not.toHaveProperty("recordedAs");
    expect(data).not.toHaveProperty("lyrics");
  });
});
