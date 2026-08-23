import { afterEach, describe, expect, it, vi } from "vitest";

import { THEME_BOOT_SCRIPT, applyTheme, storedTheme } from "./theme";

/**
 * The theme rule is written twice — once as `applyTheme`, once as the inline
 * script `app/layout.tsx` puts in every document — because nothing bundled runs
 * early enough to be the first application of a load. Adjacent definitions are
 * all the sharing that is available, so this is what stops them drifting: the
 * two disagreeing is silent in the only direction that matters, a dark-theme
 * visitor getting one white frame on every page, which no other spec would see
 * and which a light-theme machine never shows at all.
 *
 * The script is run through *indirect* eval on purpose. Direct `eval` would give
 * it the scope of this function, where a stray `var` is a local; a `<script>`
 * runs in global scope, which is the only place the leak the last case checks
 * for can happen.
 */
const runBootScript = () => (0, eval)(THEME_BOOT_SCRIPT);

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

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

describe("THEME_BOOT_SCRIPT", () => {
  it.each([
    { stored: null, systemIsDark: false, dark: false },
    { stored: null, systemIsDark: true, dark: true },
    { stored: "system", systemIsDark: false, dark: false },
    { stored: "system", systemIsDark: true, dark: true },
    { stored: "light", systemIsDark: true, dark: false },
    { stored: "dark", systemIsDark: false, dark: true },
  ])(
    "decides as applyTheme(storedTheme()) does, stored $stored with a $systemIsDark system",
    ({ stored, systemIsDark, dark }) => {
      prefersDark(systemIsDark);
      if (stored !== null) localStorage.setItem("lyrics:theme", stored);

      runBootScript();
      const fromScript = document.documentElement.classList.contains("dark");

      document.documentElement.classList.remove("dark");
      applyTheme(storedTheme());
      const fromFunction = document.documentElement.classList.contains("dark");

      expect(fromScript).toBe(dark);
      expect(fromScript).toBe(fromFunction);
    },
  );

  // The key is the half of the duplication that fails forever rather than for
  // one frame: written differently in the two places, every visitor's saved
  // choice is read back as "system" on the way in and re-saved under the other
  // name on the way out.
  it("reads the key applyTheme's own reader writes", () => {
    prefersDark(false);
    localStorage.setItem("lyrics:theme", "dark");

    runBootScript();

    expect(storedTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  // A browser that refuses to hand its storage over must leave the document
  // unthemed rather than throw before a line of the app has loaded.
  it("survives a storage that throws", () => {
    prefersDark(true);
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage is blocked");
      });

    expect(() => runBootScript()).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    getItem.mockRestore();
  });

  // An inline script runs in global scope, so `var` in there is a property of
  // `window` for the life of the page. These two are named `t` and `d`.
  it("leaves no globals behind", () => {
    prefersDark(false);

    runBootScript();

    expect("t" in globalThis).toBe(false);
    expect("d" in globalThis).toBe(false);
  });
});
