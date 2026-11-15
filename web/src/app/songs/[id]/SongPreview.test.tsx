// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { makeRecording, makeSong } from "@/test/handlers";

import { SongPreview } from "./SongPreview";

/*
 * The markup a crawler, an agent or a reader without JavaScript gets. Rendered
 * under node, as a server would, so a browser-only read here fails.
 */

function markup(song = makeSong()): string {
  return renderToStaticMarkup(<SongPreview song={song} />);
}

describe("a song as the server renders it", () => {
  it("names the song in the heading and the document title", () => {
    const html = markup();

    expect(html).toContain("<h1");
    expect(html).toContain("Θάλασσα Πλατιά</h1>");
    expect(html).toContain("<title>Θάλασσα Πλατιά — Songfolio</title>");
  });

  it("carries the lyrics, marked with the song's own language", () => {
    const html = markup();

    // A screen reader voices Greek lyrics as English without it.
    expect(html).toMatch(/<p lang="el"[^>]*>Στης θάλασσας τα βάθη\nη αγάπη μου κοιμάται<\/p>/);
  });

  it("links every credited person and performer to the catalog filtered by them", () => {
    const html = markup(makeSong({ recordings: [makeRecording()] }));

    // The same destination `PersonLinks` builds, as plain links.
    expect(html).toContain('<a href="/?person=person-1">Μίκης Θεοδωράκης</a>');
    expect(html).toContain('<a href="/?person=person-2">Γιώργος Νταλάρας</a>');
    expect(html).toContain("Performed by");
  });

  it("offers nothing that needs the app to work", () => {
    // Pressed before the app arrives, a button does nothing at all.
    expect(markup()).not.toContain("<button");
  });

  it("says so when there are no lyrics, rather than rendering an empty block", () => {
    expect(markup(makeSong({ lyrics: "  " }))).toContain("No lyrics have been added yet.");
  });
});
