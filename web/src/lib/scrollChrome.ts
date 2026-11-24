import { useSyncExternalStore } from "react";

/*
 * Whether a phone's chrome is tucked away: the top bars hidden and the bottom
 * bar shrunk to its small pill. Tucked while the reader scrolls down, back on
 * any scroll up, at the top of the page, and whenever a bar asks (a tap on the
 * pill, focus moving into the bar).
 *
 * One answer for the whole page, read through `useChromeTucked`, so every bar
 * moves on the same scroll. Each bar listening for itself would start counting
 * from wherever the page was when it mounted, and a song's top bar and the
 * bottom bar could then disagree about which way the reader last went.
 *
 * Below `md` only, but the store does not know that: each bar applies it under
 * `max-md:`, or is not on screen from `md` up at all, so nothing here has to
 * follow a window resized across the breakpoint.
 */

/** Movement smaller than this is momentum-scroll jitter, not a direction. */
const JITTER_PX = 8;

/** Within this of the top, the chrome is always out: there is nothing to give room to. */
const TOP_PX = 80;

let tucked = false;
let lastY = 0;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === tucked) return;
  tucked = next;
  for (const listener of listeners) listener();
}

function onScroll(): void {
  const y = window.scrollY;
  if (Math.abs(y - lastY) <= JITTER_PX) return;
  set(y > lastY && y > TOP_PX);
  lastY = y;
}

/**
 * The page's scroll listener is installed for the first bar and removed with
 * the last, and the state starts over then: a page with no bar left has no
 * direction to remember, and a stale "tucked" would greet the next one.
 */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    lastY = window.scrollY;
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener("scroll", onScroll);
    tucked = false;
  };
}

function snapshot(): boolean {
  return tucked;
}

/** A server, and the first render in a browser, draw the chrome out. */
function serverSnapshot(): boolean {
  return false;
}

/** Whether the chrome is tucked away. See the module comment. */
export function useChromeTucked(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Brings the chrome back without a scroll: a tap on the pill, or focus moving
 * into a bar. The next scroll down tucks it again, measured from here.
 */
export function revealChrome(): void {
  lastY = window.scrollY;
  set(false);
}
