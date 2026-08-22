import { fireEvent } from "@testing-library/react";

/*
 * Scrolling, for the one component that reads it.
 *
 * jsdom lays nothing out and its `scrollY` has no setter, so the property is
 * redefined rather than assigned and the event is dispatched by hand. Shared for
 * the usual reason: `StickyHeader`'s own spec and the song page's both drive
 * this, and the offsets below are chosen against the header's thresholds — two
 * copies would drift under the next change to them.
 */

/** Puts the window at an offset without dispatching anything. */
export function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

/**
 * Scrolls down far enough for the header to react: past its 80px floor and well
 * past the 8px it ignores as momentum jitter.
 *
 * Every spec that uses this must start from a known offset — `setScrollY(0)` in a
 * `beforeEach` — because the property outlives the render. Left where the last
 * spec put it, the next header mounts with that as its starting point and a
 * scroll to the same place is no movement at all, which passes an assertion about
 * a header staying put without having tested anything.
 */
export function scrollDown(): void {
  setScrollY(200);
  fireEvent.scroll(window);
}

/** Back to the top, which is what brings a hidden header back. */
export function scrollUp(): void {
  setScrollY(0);
  fireEvent.scroll(window);
}
