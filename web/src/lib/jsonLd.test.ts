import { describe, expect, it } from "vitest";

import { makeRecording, makeSong } from "@/test/handlers";

import { songJsonLd } from "./jsonLd";

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
