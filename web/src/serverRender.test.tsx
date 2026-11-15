// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListSongSwipe } from "@/components/ListSongNav";
import { DEFAULT_FONT_SIZE, storeFontSize, storedFontSize } from "@/lib/fontSize";
import type { ListPosition } from "@/lib/listContext";
import { storeTheme, storedTheme } from "@/lib/theme";
import { TestProviders } from "@/test/TestProviders";

/*
 * Browser-only reads, run without a browser: jsdom hands `localStorage` to
 * anything, so a render-phase read passes there and breaks once `ssr: false`
 * comes off. See CLAUDE.md, The Next.js shell.
 *
 * The theme and font-size cases only pin that those modules are safe to call on
 * a server; the swipe case, with its spy, is the one that constrains a render.
 * Named sites only; a hydration check would catch the rest.
 */

const POSITION: ListPosition = {
  listName: "Rebetika favourites",
  listHref: "/lists/list-1",
  index: 1,
  total: 3,
  previousHref: "/songs/first?list=list-1",
  nextHref: "/songs/third?list=list-1",
};

// The last case stubs `localStorage`; it must not leak into the others.
afterEach(() => vi.unstubAllGlobals());

describe("rendering without a browser", () => {
  it("has no window, storage or document to fall back on", () => {
    // The premise of every case below; a jsdom leak would pass them all silently.
    expect(typeof globalThis.window).toBe("undefined");
    expect(typeof globalThis.localStorage).toBe("undefined");
    expect(typeof globalThis.document).toBe("undefined");
  });

  it("reads the theme as unthemed and records one without complaint", () => {
    expect(storedTheme()).toBe("system");
    expect(() => storeTheme("dark")).not.toThrow();
  });

  it("reads the reader's font size as the default, and records one without complaint", () => {
    expect(storedFontSize()).toBe(DEFAULT_FONT_SIZE);
    expect(() => storeFontSize(2)).not.toThrow();
  });

  /*
   * The swipe hint decides markup, so it must start spent on both sides. The spy
   * is the load-bearing half: a wrapped read in the render body would still
   * render "", but it cannot hide the call.
   */
  it("draws no swipe mark, and asks storage nothing to decide it", () => {
    const getItem = vi.fn(() => null);
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() });

    const html = renderToString(
      // `useSwipePaging` needs the router; the address is irrelevant.
      <TestProviders>
        <ListSongSwipe position={POSITION} surface={{ current: null }} />
      </TestProviders>,
    );

    expect(html).toBe("");
    expect(getItem).not.toHaveBeenCalled();
  });
});
