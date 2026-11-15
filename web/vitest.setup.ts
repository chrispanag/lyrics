import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { StubIntersectionObserver } from "./src/test/intersection";
import { server } from "./src/test/server";

/**
 * Whether this file is running for a spec with a DOM under it. Specs marked
 * `@vitest-environment node` still run this file, and `window.scrollTo` and
 * `localStorage.clear()` would throw there.
 */
const inBrowser = typeof window !== "undefined";

beforeAll(() => {
  if (inBrowser) {
    // jsdom implements none of these, and components call them on mount. The
    // observer is controllable: see src/test/intersection.ts.
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

    // jsdom's Blob lacks arrayBuffer, which uploads read; filled in via FileReader.
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

  // An unstubbed request is a bug in the test. Outside the guard: node specs too.
  server.listen({ onUnhandledFrame: "error" });
});

afterEach(() => {
  if (inBrowser) {
    cleanup();
    localStorage.clear();
  }
  server.resetHandlers();
});

afterAll(() => server.close());
