import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { StubIntersectionObserver } from "./src/test/intersection";
import { server } from "./src/test/server";

/**
 * Whether this file is running for a spec with a DOM under it.
 *
 * All but two are: `serverRender.test.tsx` and `app/sitemap.test.ts` ask for
 * `@vitest-environment node`, and the first is the whole reason this guard
 * exists — the second is a spec that reaches the API through `api/client.ts`'s
 * *server* branch and could only ever run here. A setup file still runs for them,
 * and `window.scrollTo` and `localStorage.clear()` throw there — taking the
 * spec down before it asserted anything, which is the opposite of what a spec
 * run without a browser is for. The rest of the block is merely pointless in
 * node (a `vi.stubGlobal` lands on `globalThis` either way; Node ships
 * `Blob.prototype.arrayBuffer`, so that branch is dead), and is inside the
 * guard so that "this is the DOM setup" is one readable thing rather than a
 * line-by-line question.
 */
const inBrowser = typeof window !== "undefined";

beforeAll(() => {
  if (inBrowser) {
    // jsdom implements none of these, and the layout, theme and song page call
    // them on mount — without stubs every component test throws before
    // rendering. The observer is the one that answers back: see
    // src/test/intersection.ts.
    vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    window.scrollTo = vi.fn();

    // jsdom's Blob implements slice, size and type and nothing else, so reading
    // an image out to upload it fails there in a way it cannot in a browser. Via
    // FileReader, which jsdom does implement — the alternative is production code
    // written around a gap in the test environment.
    if (!Blob.prototype.arrayBuffer) {
      Blob.prototype.arrayBuffer = function readAsArrayBuffer(this: Blob) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error ?? new Error("could not read blob"));
          reader.readAsArrayBuffer(this);
        });
      };
    }
  }

  // Any request a test did not explicitly stub is a bug in the test, not
  // something to silently pass through to the network. `msw/node`, so it is
  // outside the guard: a spec running without a DOM must be held to it too.
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  if (inBrowser) {
    cleanup();
    localStorage.clear();
  }
  server.resetHandlers();
});

afterAll(() => server.close());
