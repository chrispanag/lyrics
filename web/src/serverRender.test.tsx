// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/api/hooks";
import { AuthProvider } from "@/auth/AuthProvider";
import { getAccessToken } from "@/auth/session";
import { ListSongSwipe } from "@/components/ListSongNav";
import { DEFAULT_FONT_SIZE, storeFontSize, storedFontSize } from "@/lib/fontSize";
import type { ListPosition } from "@/lib/listContext";
import { storeTheme, storedTheme } from "@/lib/theme";
import { makeSong, makeUser } from "@/test/handlers";
import { testQueryClient } from "@/test/providers";
import { TestProviders } from "@/test/TestProviders";
import { TestApp } from "@/test/app";

/*
 * Browser-only reads, run without a browser: jsdom hands `localStorage` to
 * anything, so a render-phase read passes there and breaks on the server that
 * now renders every route. See CLAUDE.md, The Next.js app.
 *
 * The theme and font-size cases only pin that those modules are safe to call on
 * a server; the swipe case, with its spy, is the one that constrains a render.
 * Named sites only; `hydration.test.tsx` compares a server render against the
 * browser's for the rest. The screens below only have to render here at all.
 */

// The SDK's own guard, made strict: whether a real build trips it on
// construction or only on first use varies, and a server must do neither.
const sdk = vi.hoisted(() => ({ built: 0 }));
vi.mock("@prelude.so/js-sdk/session", () => ({
  PrldSessionClient: class {
    constructor() {
      sdk.built += 1;
      if (typeof window === "undefined") {
        throw new Error("@prelude.so/js-sdk must be used in a browser-like environment");
      }
    }
  },
}));

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

  // Importing it is the whole registration, so a server imports it too.
  it("imports the session without building the SDK, and answers as a guest", async () => {
    expect(await getAccessToken()).toBeNull();
    expect(sdk.built).toBe(0);
  });

  const song = makeSong();

  it.each([
    { screen: "the catalog and its shell", route: "/" },
    { screen: "a song page", route: `/songs/${song.slug}` },
    { screen: "the profile", route: "/profile" },
  ])("renders $screen", ({ route }) => {
    const client = testQueryClient();
    client.setQueryData(keys.song(song.slug), song);

    const html = renderToString(
      <TestProviders queryClient={client} route={route} user={makeUser()}>
        <TestApp />
      </TestProviders>,
    );

    expect(html).toContain("Open menu");
  });

  // A server knows no session: guest chrome, whatever a browser remembers.
  it("renders the real auth provider as a guest", () => {
    const html = renderToString(
      <TestProviders route="/">
        <AuthProvider>
          <TestApp />
        </AuthProvider>
      </TestProviders>,
    );

    expect(html).toContain("Sign in");
    expect(sdk.built).toBe(0);
  });
});
