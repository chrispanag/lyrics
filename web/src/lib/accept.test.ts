import { describe, expect, it } from "vitest";

import { HTML, MARKDOWN, preferredType } from "./accept";

describe("preferredType", () => {
  it("prefers HTML when the client names nothing", () => {
    expect(preferredType(null)).toBe(HTML);
    expect(preferredType("")).toBe(HTML);
    expect(preferredType("   ")).toBe(HTML);
  });

  it("serves Markdown when that is the only accepted type", () => {
    expect(preferredType("text/markdown")).toBe(MARKDOWN);
    expect(preferredType("text/markdown; charset=utf-8")).toBe(MARKDOWN);
  });

  it("serves HTML when the client asks for it", () => {
    expect(preferredType("text/html")).toBe(HTML);
    expect(preferredType("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(
      HTML,
    );
  });

  it("ranks by q and lets a specific range beat a wildcard", () => {
    expect(preferredType("text/markdown, text/html;q=0.8")).toBe(MARKDOWN);
    expect(preferredType("text/html, text/markdown;q=0.1")).toBe(HTML);
    // q=0 rejects HTML; the wildcard may still select Markdown.
    expect(preferredType("text/html;q=0, */*")).toBe(MARKDOWN);
    expect(preferredType("text/markdown;q=0, text/html")).toBe(HTML);
  });

  it("rejects a client that accepts neither representation", () => {
    expect(preferredType("application/pdf")).toBeNull();
    expect(preferredType("text/markdown;q=0, text/html;q=0")).toBeNull();
    expect(preferredType("text/markdown;q=0")).toBeNull();
  });

  it("ignores a quality value that is not a number and clamps one that is out of range", () => {
    expect(preferredType("text/markdown;q=nope")).toBe(MARKDOWN);
    expect(preferredType("text/markdown;q=2, text/html;q=0.5")).toBe(MARKDOWN);
    expect(preferredType("text/html; q = 0.2 , text/markdown")).toBe(MARKDOWN);
  });

  it("treats a type wildcard as that type, with HTML winning a tie", () => {
    expect(preferredType("text/*")).toBe(HTML);
  });
});
