import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  NAV_COLLAPSED_ATTRIBUTE,
  NAV_COLLAPSED_BOOT_SCRIPT,
  applyNavCollapsed,
  storeNavCollapsed,
  storedNavCollapsed,
} from "./navCollapsed";

/**
 * Holds the inline boot script to `storedNavCollapsed()`, which the shell
 * re-applies on mount. A divergence shows as a column the script hid and a
 * shell that opens. Indirect eval, so it runs in global scope like a real
 * `<script>`.
 */
// biome-ignore lint/security/noGlobalEval: runs our own constant, and global scope is the point.
const runBootScript = () => globalThis.eval(NAV_COLLAPSED_BOOT_SCRIPT);

const collapsed = () => document.documentElement.hasAttribute(NAV_COLLAPSED_ATTRIBUTE);

const KEY = "lyrics:nav-collapsed";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute(NAV_COLLAPSED_ATTRIBUTE);
});

describe("NAV_COLLAPSED_BOOT_SCRIPT", () => {
  it.each([
    null,
    "1",
    // Anything but the one stored value is open, in both.
    "",
    "0",
    "true",
    "collapsed",
  ])("draws stored %j as storedNavCollapsed() answers", (stored) => {
    if (stored !== null) localStorage.setItem(KEY, stored);

    runBootScript();

    expect(collapsed()).toBe(storedNavCollapsed());
  });

  it("leaves the column open rather than writing the attribute", () => {
    runBootScript();
    expect(collapsed()).toBe(false);
  });

  it("survives storage that refuses to be read", () => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new DOMException("denied", "SecurityError");
    };
    try {
      expect(runBootScript).not.toThrow();
      expect(collapsed()).toBe(false);
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });

  it("declares nothing on window", () => {
    localStorage.setItem(KEY, "1");
    runBootScript();
    expect(window).not.toHaveProperty("c");
  });
});

describe("a choice the reader makes", () => {
  it("is drawn at once and read back by the next load's script", () => {
    applyNavCollapsed(true);
    storeNavCollapsed(true);
    expect(collapsed()).toBe(true);

    document.documentElement.removeAttribute(NAV_COLLAPSED_ATTRIBUTE);
    runBootScript();
    expect(collapsed()).toBe(true);
  });

  it("forgets a column the reader opens again", () => {
    storeNavCollapsed(true);
    storeNavCollapsed(false);

    expect(localStorage.getItem(KEY)).toBeNull();
    runBootScript();
    expect(collapsed()).toBe(false);
  });
});

describe("the stylesheet", () => {
  // jsdom applies no Tailwind, so the rules themselves are what can be read.
  const css = readFileSync(path.join(import.meta.dirname, "../styles/index.css"), "utf8");

  it("slides the column shut, and the menu button back, while the attribute is set", () => {
    expect(css).toContain("html:not([data-nav-collapsed]) .nav-sidebar");
    expect(css).toContain("html:not([data-nav-collapsed]) .nav-menu-button");
    expect(css).toContain("html:not([data-nav-collapsed]) .nav-menu-header");
    // The same 250ms ease-out as a sheet. Width, because `display` cannot move.
    expect(css).toContain("--nav-width: 15rem");
    expect(css).toContain("width: var(--nav-width)");
    expect(css).toContain("width: 0");
    expect(css).toContain("width 250ms ease-out");
  });

  // 48rem is Tailwind's `md` and `@3xl`: the width the content column has from
  // `md` up once the sidebar is out of it. The panes and this padding share it.
  it("drops the page padding once that column can hold the two panes", () => {
    expect(css).toContain("@container app (width >= 48rem)");
    expect(css).toContain(".app-column");
  });
});
