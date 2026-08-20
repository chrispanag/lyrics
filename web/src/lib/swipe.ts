/*
 * A horizontal swipe, read from where a touch started and where it ended.
 *
 * The measurements live here, apart from the listener that takes them, because
 * every one of them is a threshold that decides whether a reader's gesture pages
 * the song or is left alone — and a threshold nobody can put a number to in a
 * test is a threshold that drifts. The listener is in `ListSongNav`.
 *
 * Two of these rules are the whole reason the gesture is safe to have at all:
 *
 * - It must **start clear of both screen edges.** An edge swipe belongs to the
 *   browser — it is back and forward in Safari, and the system's back gesture on
 *   Android — so a gesture that begins there is already spoken for, and reading
 *   it as well would page the list *and* leave the page in the same movement.
 * - It must be **decidedly horizontal.** Reading a song is vertical scrolling,
 *   which is the same gesture with the axes swapped, so the two are told apart
 *   by which way the finger actually went.
 */

/** How far in from either screen edge a swipe has to start. */
const EDGE_GUARD_PX = 44;

/** How far it has to travel sideways. */
const MIN_TRAVEL_PX = 60;

/** How much further sideways than vertically, so a scroll is never a swipe. */
const AXIS_RATIO = 2;

/**
 * How long it may take. A flick is a couple of hundred milliseconds; the cap is
 * what keeps a finger resting on the page and drifting from paging the song when
 * it lifts.
 */
const MAX_DURATION_MS = 800;

/** Which way through the list a swipe goes, or null when it was not one. */
export type SwipeDirection = "previous" | "next";

/**
 * Whether a touch started somewhere the browser has not already claimed.
 *
 * Measured against the viewport rather than the element the gesture is read on:
 * the edges belong to the browser wherever an element happens to sit.
 */
export function startsClearOfEdges(clientX: number, viewportWidth: number): boolean {
  return clientX >= EDGE_GUARD_PX && clientX <= viewportWidth - EDGE_GUARD_PX;
}

/**
 * The step a completed gesture asks for, or null if it was not a swipe.
 *
 * Left is onward, the way a page turns and a carousel moves.
 */
export function swipeDirection(dx: number, dy: number, durationMs: number): SwipeDirection | null {
  if (durationMs > MAX_DURATION_MS) return null;
  if (Math.abs(dx) < MIN_TRAVEL_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) return null;

  return dx < 0 ? "next" : "previous";
}
