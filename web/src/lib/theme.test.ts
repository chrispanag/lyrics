import { afterEach, describe, expect, it, vi } from "vitest";

import { THEME_BOOT_SCRIPT, applyTheme, storedTheme } from "./theme";

/**
 * Holds the inline boot script to `applyTheme(storedTheme())`; a divergence shows
 * only as a white frame for dark-theme visitors.
 *
 * Indirect eval, so the script runs in global scope like a real `<script>`.
 */
// biome-ignore lint/complexity/noCommaOperator: `(0, eval)` is what makes the eval indirect.
// biome-ignore lint/security/noGlobalEval: runs our own constant, and global scope is the point.
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
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage is blocked");
      });

    expect(() => runBootScript()).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    getItem.mockRestore();
  });

  // A `var` in an inline script lands on `window`.
  it("leaves no globals behind", () => {
    prefersDark(false);

    runBootScript();

    expect("t" in globalThis).toBe(false);
    expect("d" in globalThis).toBe(false);
  });
});
