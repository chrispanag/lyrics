import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { StubIntersectionObserver } from "./src/test/intersection";
import { server } from "./src/test/server";

// jsdom implements none of these, and the layout, theme and song page call them
// on mount — without stubs every component test throws before rendering. The
// observer is the one that answers back: see src/test/intersection.ts.
beforeAll(() => {
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

  // Any request a test did not explicitly stub is a bug in the test, not
  // something to silently pass through to the network.
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});

afterAll(() => server.close());
