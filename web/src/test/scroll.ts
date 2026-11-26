import { fireEvent } from "@testing-library/react";

/*
 * Scrolling for `StickyHeader`'s specs. jsdom's `scrollY` has no setter, so it
 * is redefined and the event dispatched by hand.
 */

/** Puts the window at an offset without dispatching anything. */
export function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

/** Scrolls the window to an offset, as a reader's scroll would. */
export function scrollToY(y: number): void {
  setScrollY(y);
  fireEvent.scroll(window);
}

/**
 * Scrolls down past the chrome's 80px floor and its 40px stretch. Callers
 * must `setScrollY(0)` in a `beforeEach`: the property outlives the render, and
 * a stale offset makes this no movement at all.
 */
export function scrollDown(): void {
  scrollToY(200);
}

/** Back to the top, which is what brings a hidden header back. */
export function scrollUp(): void {
  scrollToY(0);
}
