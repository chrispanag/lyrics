import { afterEach, describe, expect, it, vi } from "vitest";

import { THEME_BOOT_SCRIPT, THEME_COLORS, applyTheme, storedTheme } from "./theme";

/**
 * Holds the inline boot script to `applyTheme(storedTheme())`; a divergence shows
 * only as a white frame for dark-theme visitors.
 *
 * Indirect eval, so the script runs in global scope like a real `<script>`.
 */
// biome-ignore lint/security/noGlobalEval: runs our own constant, and global scope is the point.
const runBootScript = () => globalThis.eval(THEME_BOOT_SCRIPT);

const prefersDark = (matches: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((media: string) => ({
      matches,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

/** The explicit theme's color, or null when the media-scoped pair decides. */
const themeColorOverride = () =>
  document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')?.content ??
  null;

/** Undoes what either path writes, leaving storage alone. */
const resetDom = () => {
  document.documentElement.classList.remove("dark");
  for (const meta of document.head.querySelectorAll('meta[name="theme-color"]')) meta.remove();
};

afterEach(() => {
  localStorage.clear();
  resetDom();
  vi.unstubAllGlobals();
});

describe("THEME_BOOT_SCRIPT", () => {
  it.each([
    { stored: null, systemIsDark: false, dark: false, color: null },
    { stored: null, systemIsDark: true, dark: true, color: null },
    { stored: "system", systemIsDark: false, dark: false, color: null },
    { stored: "system", systemIsDark: true, dark: true, color: null },
    { stored: "light", systemIsDark: true, dark: false, color: THEME_COLORS.light },
    { stored: "dark", systemIsDark: false, dark: true, color: THEME_COLORS.dark },
  ])(
    "decides as applyTheme(storedTheme()) does, stored $stored with a $systemIsDark system",
    ({ stored, systemIsDark, dark, color }) => {
      prefersDark(systemIsDark);
      if (stored !== null) localStorage.setItem("lyrics:theme", stored);

      runBootScript();
      const fromScript = document.documentElement.classList.contains("dark");
      const colorFromScript = themeColorOverride();

      resetDom();
      applyTheme(storedTheme());
      const fromFunction = document.documentElement.classList.contains("dark");

      expect(fromScript).toBe(dark);
      expect(fromScript).toBe(fromFunction);
      expect(colorFromScript).toBe(color);
      expect(colorFromScript).toBe(themeColorOverride());
    },
  );

  // The browser reads the first matching meta in tree order, so ours must lead
  // the media-scoped pair, and a switch must update it rather than add another.
  it("puts the explicit color ahead of the media-scoped pair, and hands back on system", () => {
    prefersDark(false);
    document.head.innerHTML =
      `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}">` +
      `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}">`;
    localStorage.setItem("lyrics:theme", "dark");

    runBootScript();
    applyTheme("light");
    applyTheme("dark");

    const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    expect(metas).toHaveLength(3);
    expect(metas[0]?.hasAttribute("media")).toBe(false);
    expect(metas[0]?.content).toBe(THEME_COLORS.dark);

    applyTheme("system");

    expect(themeColorOverride()).toBeNull();
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(2);
  });

  // A mismatched key would silently ignore every saved choice.
  it("reads the key applyTheme's own reader writes", () => {
    prefersDark(false);
    localStorage.setItem("lyrics:theme", "dark");

    runBootScript();

    expect(storedTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("survives a storage that throws", () => {
    prefersDark(true);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });

    expect(() => runBootScript()).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(themeColorOverride()).toBeNull();

    getItem.mockRestore();
  });

  // A `var` in an inline script lands on `window`.
  it("leaves no globals behind", () => {
    prefersDark(false);
    localStorage.setItem("lyrics:theme", "dark");

    runBootScript();

    expect("t" in globalThis).toBe(false);
    expect("d" in globalThis).toBe(false);
    expect("m" in globalThis).toBe(false);
  });
});
