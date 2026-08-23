// @vitest-environment node
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListSongSwipe } from "@/components/ListSongNav";
import { DEFAULT_FONT_SIZE, storeFontSize, storedFontSize } from "@/lib/fontSize";
import type { ListPosition } from "@/lib/listContext";
import { storeTheme, storedTheme } from "@/lib/theme";

/*
 * The parts of the app that a server may one day render, run where no browser
 * is.
 *
 * `AppRoot` is imported through `dynamic(..., { ssr: false })` today, so every
 * one of these executes in a browser and only there — which is exactly why this
 * has to be its own environment rather than an assertion inside the jsdom
 * suite. jsdom hands out a `window` and a `localStorage` to anything that asks,
 * so a render-phase `localStorage.getItem` passes every spec in the suite and
 * fails the moment the `ssr: false` comes off. This runs with neither, which is
 * the only readable form of "safe on a server" available here.
 *
 * This is the first spec in the suite to ask for its own environment, so the
 * pragma has no precedent to point at — what it borrows from
 * `auth/session.test.ts` is the reasoning and not the mechanism: strip away the
 * thing that would hide the failure. There it is React, which the spec runs
 * without; here it is the browser.
 *
 * Two of the four reads this pins are the ones that matter, and it is not
 * because their storage throws — a try/catch would answer that. It is that a
 * value only the browser holds, read during a render the server also performed,
 * makes the two disagree: React 19 answers a mismatch by discarding the
 * server's HTML and rendering the whole root again. So each starts from the
 * default and takes the stored answer in a layout effect, which a server render
 * does not run.
 *
 * The first two cases are weaker than the last, and knowing which is which
 * matters. Every one of these reads is wrapped, so none of them can throw here
 * any more — which means asserting `storedTheme()` and `storedFontSize()`
 * answer their defaults pins that those modules are safe to *call* from a
 * server, and nothing at all about whether something calls them mid-render. The
 * last case is the one that constrains a render, and it takes a spy to do it:
 * see the comment on it.
 *
 * What is *not* pinned is the whole tree. This names its sites rather than
 * catching them, so a site nobody thought of is a site nobody covers. The
 * mechanism that would catch them all is a hydration check — render, seed the
 * storage, `hydrateRoot`, assert React recovered from nothing — and it belongs
 * with the work that drops `ssr: false`, which is where the two sites it would
 * find today (`ProfilePage` and `AuthProvider`, both still reading storage in a
 * render body) are in scope to fix.
 */

const POSITION: ListPosition = {
  listName: "Rebetika favourites",
  listHref: "/lists/list-1",
  index: 1,
  total: 3,
  previousHref: "/songs/first?list=list-1",
  nextHref: "/songs/third?list=list-1",
};

// The last case stubs a `localStorage` in; without this the case above it would
// find one and stop testing what it says it tests.
afterEach(() => vi.unstubAllGlobals());

describe("rendering without a browser", () => {
  it("has no window, storage or document to fall back on", () => {
    // The premise of every case below. Asserted rather than assumed, because a
    // jsdom leak into this file would make all of them pass for the wrong
    // reason — and silently, since each answers the same as it would in a
    // browser with nothing stored.
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
   * The swipe hint is the one of the four that really decides markup:
   * `ListSongSwipe` returns null outright while the hook answers null, so the
   * observed box either exists or it does not. Starting spent is what makes the
   * server's answer and the client's first render the same one — no box — with
   * the layout effect mounting it a tick later.
   *
   * Empty output is half the assertion and no longer the load-bearing half. A
   * spy is: now that every one of these reads is wrapped, "there is no storage"
   * and "nothing asked for any" produce identical output, so a read put back
   * into a render body would answer its own catch and render the same empty
   * string. The call is the thing a try/catch cannot hide.
   */
  it("draws no swipe mark, and asks storage nothing to decide it", () => {
    const getItem = vi.fn(() => null);
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() });

    const html = renderToString(
      // The router is load-bearing and its address is not: `useSwipePaging`
      // needs a `useNavigate`, and nothing here reads the location.
      <MemoryRouter>
        <ListSongSwipe position={POSITION} surface={{ current: null }} />
      </MemoryRouter>,
    );

    expect(html).toBe("");
    expect(getItem).not.toHaveBeenCalled();
  });
});
