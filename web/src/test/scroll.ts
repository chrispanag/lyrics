import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

/*
 * Scrolling for `StickyHeader`'s specs. jsdom's `scrollY` has no setter, so it
 * is redefined and the event dispatched by hand.
 */

/** Puts the window at an offset without dispatching anything. */
export function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

/**
 * Scrolls the window to an offset, as a reader's scroll would, and runs the
 * frame after it: the chrome draws a scroll on the next frame
 * (`lib/scrollChrome`), which jsdom would otherwise leave for a timer.
 */
export function scrollToY(y: number): void {
  setScrollY(y);
  const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(performance.now());
    return 0;
  });
  try {
    fireEvent.scroll(window);
  } finally {
    frame.mockRestore();
  }
}

/**
 * Scrolls down past the chrome's 40px stretch. Callers must `setScrollY(0)` in
 * a `beforeEach`: the property outlives the render, and a stale offset makes
 * this no movement at all.
 */
export function scrollDown(): void {
  scrollToY(200);
}

/** Back to the top, which is what brings a hidden header back. */
export function scrollUp(): void {
  scrollToY(0);
}

/** The scroll coming to rest, as a browser with `scrollend` says it. */
export function scrollEnd(): void {
  fireEvent(window, new Event("scrollend"));
}

/** Gives the page `scrollable` pixels to scroll past the viewport. */
export function setPageLength(scrollable: number): void {
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(
    window.innerHeight + scrollable,
  );
}
