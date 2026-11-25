import { useEffect } from "react";

/*
 * Whether a phone's chrome is tucked away: the top bars hidden and the bottom
 * bar shrunk to its small pill. Tucked while the reader scrolls down, back on
 * any scroll up, at the top of the page, and whenever a bar asks (a tap on the
 * pill, focus moving into the bar).
 *
 * One answer for the whole page, so every bar moves on the same scroll. Each
 * bar listening for itself would start counting from wherever the page was
 * when it mounted, and a song's top bar and the bottom bar could then disagree
 * about which way the reader last went.
 *
 * The answer is `data-chrome-tucked` on <html>, which index.css draws from,
 * not React state: a tuck happens on every change of scroll direction, and
 * drawing it through React would re-render each bar and the page holding one,
 * for a change that is only a transform. Nothing React renders reads it.
 *
 * Below `md` only, but the store does not know that: each bar applies it under
 * `max-md:`, or is not on screen from `md` up at all, so nothing here has to
 * follow a window resized across the breakpoint.
 */

/** What index.css keys the tucked chrome on. */
export const CHROME_TUCKED_ATTRIBUTE = "data-chrome-tucked";

/** Movement smaller than this is momentum-scroll jitter, not a direction. */
const JITTER_PX = 8;

/** Within this of the top, the chrome is always out: there is nothing to give room to. */
const TOP_PX = 80;

let tucked = false;
let lastY = 0;
let bars = 0;

function set(next: boolean): void {
  if (next === tucked) return;
  tucked = next;
  document.documentElement.toggleAttribute(CHROME_TUCKED_ATTRIBUTE, next);
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
function register(): () => void {
  if (bars === 0) {
    lastY = window.scrollY;
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  bars += 1;
  return () => {
    bars -= 1;
    if (bars > 0) return;
    window.removeEventListener("scroll", onScroll);
    set(false);
  };
}

/**
 * Takes part in the page's tucking, for a bar index.css moves with it. In an
 * effect, so a server and the first render in a browser draw the chrome out.
 * Returns nothing: the bar re-renders for none of it.
 */
export function useChromeScroll(): void {
  useEffect(register, []);
}

/**
 * Brings the chrome back without a scroll: a tap on the pill, or focus moving
 * into a bar. The next scroll down tucks it again, measured from here.
 */
export function revealChrome(): void {
  lastY = window.scrollY;
  set(false);
}
