import { describe, expect, it } from "vitest";

import { listInView, songCanonicalHref, songRefIsId, songSection } from "./listContext";

/*
 * The two halves of the id-to-slug redirect, pinned from both sides: too narrow
 * leaves old links uncanonicalized, too wide redirects ordinary slugs, and a
 * dropped query string silently takes the reader out of the list.
 */

describe("songRefIsId", () => {
  const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  it("reads both spellings a UUID is written in", () => {
    expect(songRefIsId(ID)).toBe(true);
    // Dashes left out: Go's uuid.Parse takes it, and migration 000010 reserves it.
    expect(songRefIsId(ID.replaceAll("-", ""))).toBe(true);
    // Hex is hex whichever case it arrives in.
    expect(songRefIsId(ID.toUpperCase())).toBe(true);
  });

  it("reads a slug as a slug, including the ones that look close", () => {
    expect(songRefIsId("to-tragoydi-tis-agapis")).toBe(false);
    expect(songRefIsId("thalassa-platia-2")).toBe(false);
    // Slugs may hold dashes and digits; only the exact arrangement differs.
    expect(songRefIsId("1964")).toBe(false);
    expect(songRefIsId("dead-beef")).toBe(false);
    expect(songRefIsId(`${ID}-live`)).toBe(false);
    expect(songRefIsId(ID.slice(0, -1))).toBe(false);
    // 32 characters, but `g` is not hex.
    expect(songRefIsId("g".repeat(32))).toBe(false);
  });
});

describe("songCanonicalHref", () => {
  it("carries the list the old link was holding", () => {
    expect(songCanonicalHref("thalassa-platia", { list: "list-1" })).toBe(
      "/songs/thalassa-platia?list=list-1",
    );
  });

  it("is a bare address when there was no query", () => {
    expect(songCanonicalHref("thalassa-platia", {})).toBe("/songs/thalassa-platia");
  });

  it("encodes what it carries, and keeps a parameter that repeats", () => {
    expect(songCanonicalHref("thalassa-platia", { q: "αγάπη & θάλασσα" })).toBe(
      "/songs/thalassa-platia?q=%CE%B1%CE%B3%CE%AC%CF%80%CE%B7+%26+%CE%B8%CE%AC%CE%BB%CE%B1%CF%83%CF%83%CE%B1",
    );
    expect(songCanonicalHref("thalassa-platia", { tag: ["a", "b"] })).toBe(
      "/songs/thalassa-platia?tag=a&tag=b",
    );
  });
});

describe("listInView", () => {
  const search = (query: string) => new URLSearchParams(query);

  it("is the list on its own page, and the one a song is read from", () => {
    expect(listInView("/lists/list-1", search(""))).toBe("list-1");
    expect(listInView("/songs/thalassa-platia", search("list=list-1"))).toBe("list-1");
  });

  // A song read from no list belongs to the catalog, as does every other screen.
  it("is no list anywhere else", () => {
    expect(listInView("/songs/thalassa-platia", search(""))).toBeNull();
    expect(listInView("/songs/thalassa-platia", search("list="))).toBeNull();
    expect(listInView("/", search("list=list-1"))).toBeNull();
    expect(listInView("/lists", search(""))).toBeNull();
    expect(listInView("/songs/thalassa-platia/edit", search("list=list-1"))).toBeNull();
  });
});

describe("songSection", () => {
  const search = (query: string) => new URLSearchParams(query);

  it("is the entry whose songs sit beside a song", () => {
    expect(songSection("/songs/thalassa-platia", search("list=list-1"))).toBe("/lists");
    expect(songSection("/songs/thalassa-platia", search(""))).toBe("/");
    expect(songSection("/songs/thalassa-platia", search("list="))).toBe("/");
  });

  it("leaves every other screen to its path", () => {
    expect(songSection("/lists/list-1", search(""))).toBeUndefined();
    expect(songSection("/", search("list=list-1"))).toBeUndefined();
    // The song editor, not a song: `new` is no slug.
    expect(songSection("/songs/new", search(""))).toBeUndefined();
  });
});
