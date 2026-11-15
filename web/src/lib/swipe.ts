/*
 * A horizontal swipe, read from where a touch started and where it ended. The
 * thresholds live here so specs can pin them; the listener is in `ListSongNav`.
 *
 * - It must **start clear of both screen edges**, which belong to the browser's
 *   back/forward gestures.
 * - It must be **decidedly horizontal**, so vertical scrolling is never a swipe.
 */

/** How far in from either screen edge a swipe has to start. */
const EDGE_GUARD_PX = 44;

/** How far it has to travel sideways. */
const MIN_TRAVEL_PX = 60;

/** How much further sideways than vertically, so a scroll is never a swipe. */
const AXIS_RATIO = 2;

/** How long it may take, so a resting, drifting finger does not page the song. */
const MAX_DURATION_MS = 800;

/** Which way through the list a swipe goes, or null when it was not one. */
export type SwipeDirection = "previous" | "next";

/**
 * Whether a touch started somewhere the browser has not already claimed.
 * Measured against the viewport, not the element.
 */
export function startsClearOfEdges(clientX: number, viewportWidth: number): boolean {
  return clientX >= EDGE_GUARD_PX && clientX <= viewportWidth - EDGE_GUARD_PX;
}

/** The step a completed gesture asks for, or null if it was not a swipe. Left is onward. */
export function swipeDirection(dx: number, dy: number, durationMs: number): SwipeDirection | null {
  if (durationMs > MAX_DURATION_MS) return null;
  if (Math.abs(dx) < MIN_TRAVEL_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) return null;

  return dx < 0 ? "next" : "previous";
}
