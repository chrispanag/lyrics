import { describe, expect, it } from "vitest";

import { songCanonicalHref, songRefIsId } from "./listContext";

/*
 * The two halves of the id-to-slug redirect, which is the one canonicalization
 * in the stack and lives on the server.
 *
 * Both are pinned from both sides, because both fail silently in one direction
 * only. A predicate that is too narrow leaves an old link on the id form
 * forever — which still works, so nothing says so; too wide, it fires on a
 * perfectly ordinary slug and redirects a reader to an address the API cannot
 * resolve. And a redirect that drops the query string leaves the reader on the
 * song with the list gone: the page renders, there is simply no bar, no swipe
 * and no arrow keys.
 */

describe("songRefIsId", () => {
  const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  it("reads both spellings a UUID is written in", () => {
    expect(songRefIsId(ID)).toBe(true);
    // The dashes left out, which is the form Go's uuid.Parse also takes and
    // which migration 000010 reserves for exactly that reason. Missed here, a
    // link in this shape would be answered by the resolver and never
    // canonicalized.
    expect(songRefIsId(ID.replaceAll("-", ""))).toBe(true);
    // Hex is hex whichever case it arrives in.
    expect(songRefIsId(ID.toUpperCase())).toBe(true);
  });

  it("reads a slug as a slug, including the ones that look close", () => {
    expect(songRefIsId("to-tragoydi-tis-agapis")).toBe(false);
    expect(songRefIsId("thalassa-platia-2")).toBe(false);
    // The shapes worth naming: a slug is allowed dashes and digits, so what
    // separates it from an id is only ever the exact arrangement of them.
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
