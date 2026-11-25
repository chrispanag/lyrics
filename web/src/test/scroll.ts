import { fireEvent } from "@testing-library/react";

/*
 * Scrolling for `StickyHeader`'s specs. jsdom's `scrollY` has no setter, so it
 * is redefined and the event dispatched by hand.
 */

/** Puts the window at an offset without dispatching anything. */
export function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

/**
 * Scrolls down past the chrome's 80px floor and 40px tuck threshold. Callers
 * must `setScrollY(0)` in a `beforeEach`: the property outlives the render, and
 * a stale offset makes this no movement at all.
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
