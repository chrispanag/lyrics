import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InfiniteScrollTrigger } from "./InfiniteScrollTrigger";

/** Reports a size to the trigger's observer, as a resize of `main` would. */
let resize: (width: number, height?: number) => void = () => {};

/** Swaps in an observer the spec drives, and hands back the setup file's. */
function stubResizeObserver(): () => void {
  const setupStub = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resize = (width, height = 600) =>
        callback(
          [{ contentRect: { width, height } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  return () => {
    globalThis.ResizeObserver = setupStub;
  };
}

describe("InfiniteScrollTrigger", () => {
  // Collapsing the navigation resizes the column every frame for 250ms. The
  // scroller can only change with the width, so it is looked for once, after.
  it("looks for its scroller again once the column's width settles", () => {
    vi.useFakeTimers();
    const restore = stubResizeObserver();
    try {
      render(
        <main>
          <InfiniteScrollTrigger onLoadMore={() => {}} />
        </main>,
      );
      const walks = vi.spyOn(window, "getComputedStyle");

      resize(800); // The observer's first report, of the size already walked at.
      resize(800, 900); // Height only: a page loaded.
      expect(walks).not.toHaveBeenCalled();

      for (let width = 790; width >= 600; width -= 10) {
        resize(width);
        vi.advanceTimersByTime(16);
      }
      expect(walks).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      // One walk: the trigger's parent, then `main`'s, up to the document.
      const calls = walks.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      vi.advanceTimersByTime(1000);
      expect(walks).toHaveBeenCalledTimes(calls);
    } finally {
      vi.useRealTimers();
      restore();
    }
  });
});
