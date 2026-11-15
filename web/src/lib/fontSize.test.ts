import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_ATTRIBUTE,
  FONT_SIZE_BOOT_SCRIPT,
  FONT_SIZES,
  applyFontSize,
  storeFontSize,
  storedFontSize,
} from "./fontSize";

/**
 * Holds the inline boot script to `storedFontSize()`, which the size buttons'
 * limits read; a divergence shows as lyrics at one size beside buttons that
 * think it is another. Indirect eval, so it runs in global scope like a real
 * `<script>`.
 */
// biome-ignore lint/security/noGlobalEval: runs our own constant, and global scope is the point.
const runBootScript = () => globalThis.eval(FONT_SIZE_BOOT_SCRIPT);

/** The step the lyrics are drawn at: the attribute, or the default without one. */
const drawnStep = () => {
  const attribute = document.documentElement.getAttribute(FONT_SIZE_ATTRIBUTE);
  return attribute === null ? DEFAULT_FONT_SIZE : Number(attribute);
};

const KEY = "lyrics:font-size";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute(FONT_SIZE_ATTRIBUTE);
});

describe("FONT_SIZE_BOOT_SCRIPT", () => {
  it.each([
    null,
    "0",
    "1",
    "2",
    "3",
    // Everything `storedFontSize` refuses, each of which must leave the default.
    "4",
    "-1",
    "1.5",
    "",
    " ",
    "abc",
    "Infinity",
    "NaN",
  ])("draws stored %j at the step storedFontSize() answers", (stored) => {
    if (stored !== null) localStorage.setItem(KEY, stored);

    runBootScript();

    expect(drawnStep()).toBe(storedFontSize());
  });

  it("leaves the default to the stylesheet rather than writing it", () => {
    runBootScript();
    expect(document.documentElement.hasAttribute(FONT_SIZE_ATTRIBUTE)).toBe(false);
  });

  it("survives storage that refuses to be read", () => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new DOMException("denied", "SecurityError");
    };
    try {
      expect(runBootScript).not.toThrow();
      expect(drawnStep()).toBe(DEFAULT_FONT_SIZE);
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });

  it("declares nothing on window", () => {
    localStorage.setItem(KEY, "2");
    runBootScript();
    expect(window).not.toHaveProperty("r");
    expect(window).not.toHaveProperty("n");
  });
});

describe("a step the reader chooses", () => {
  it("is drawn at once and read back by the next load's script", () => {
    applyFontSize(3);
    storeFontSize(3);
    expect(drawnStep()).toBe(3);

    document.documentElement.removeAttribute(FONT_SIZE_ATTRIBUTE);
    runBootScript();
    expect(drawnStep()).toBe(3);
  });
});

describe("the stylesheet", () => {
  // jsdom applies no Tailwind, so the rules themselves are what can be read.
  const css = readFileSync(path.join(import.meta.dirname, "../styles/index.css"), "utf8");

  it("sizes the lyrics for every step, with the default step when there is no attribute", () => {
    FONT_SIZES.forEach((token, step) => {
      expect(css).toContain(
        `:root[data-lyrics-size="${step}"] .lyrics-size {\n    font-size: --theme(${token} inline);`,
      );
    });
    expect(css).toContain(
      `.lyrics-size {\n    font-size: --theme(${FONT_SIZES[DEFAULT_FONT_SIZE]} inline);`,
    );
  });
});
