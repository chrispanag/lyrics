import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { NAV_COLLAPSED_ATTRIBUTE } from "./src/lib/navCollapsed";
import { installDialogStub } from "./src/test/dialog";
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
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    window.scrollTo = vi.fn();
    // The navigation drawer opens and closes by scrolling its own scroller.
    Element.prototype.scrollTo = vi.fn();
    // And its list takes the vertical scrolling keys from the page.
    Element.prototype.scrollBy = vi.fn();
    // `Sheet` is a modal `<dialog>`; see src/test/dialog.ts.
    installDialogStub();
  }

  // An unstubbed request is a bug in the test. Outside the guard: node specs too.
  server.listen({ onUnhandledFrame: "error" });
});

afterEach(() => {
  if (inBrowser) {
    cleanup();
    localStorage.clear();
    // A size button writes this on <html>, which outlives `cleanup()`, and the
    // buttons read it back (lib/fontSize.ts): left, it leaks into the next spec.
    document.documentElement.removeAttribute("data-lyrics-size");
    document.documentElement.removeAttribute(NAV_COLLAPSED_ATTRIBUTE);
  }
  server.resetHandlers();
});

afterAll(() => server.close());
