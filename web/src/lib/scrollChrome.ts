import { useEffect } from "react";

/*
 * Whether a phone's chrome is tucked away: the top bars hidden and the bottom
 * bar shrunk to its small pill. Tucked once the reader has scrolled down a
 * little way, back on any scroll up, at the top of the page, and whenever
 * something asks (a tap on the pill, focus moving into a bar, a new screen).
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

/**
 * How far the reader must scroll down, in one go, before the chrome tucks: a
 * nudge while reading is not a decision to read on, and the bars leaving for
 * one would flicker.
 */
const TUCK_PX = 40;

/**
 * How far up is a turn: little, since a reader reaching for the bars scrolls
 * up a touch and expects them at once. Less than this is momentum-scroll
 * jitter, or the fractional offsets of a phone's toolbar resizing, and turns
 * nothing either way.
 */
const TURN_PX = 8;

/** Within this of the top, the chrome is always out: there is nothing to give room to. */
const TOP_PX = 80;

let tucked = false;
/**
 * Where the current stretch started, so each threshold counts from the turn,
 * however slowly the reader got there: while out, the lowest the page has been
 * since it last turned up; while tucked, the furthest it has gone down.
 */
let anchorY = 0;
/** While out, the furthest down since `anchorY`: a turn up is measured from here. */
let peakY = 0;
let bars = 0;

/** Starts the count over from where the page is. */
function anchorAt(y: number): void {
  anchorY = y;
  peakY = y;
}

function set(next: boolean): void {
  if (next === tucked) return;
  tucked = next;
  document.documentElement.toggleAttribute(CHROME_TUCKED_ATTRIBUTE, next);
}

/**
 * Whether `y` is past the end of a page that scrolls at all: iOS's bounce,
 * whose way back reads as a scroll up and would bring the chrome out.
 */
function pastEnd(y: number): boolean {
  const end = document.documentElement.scrollHeight - window.innerHeight;
  return end > 0 && y > end;
}

/*
 * The end of a page brings nothing out: a flick that tucks the chrome on its
 * way down would bring it straight back on arrival.
 */
function onScroll(): void {
  const y = window.scrollY;
  if (y <= TOP_PX) set(false);
  else if (pastEnd(y)) return;
  else if (tucked) {
    // Still going down moves the count's start with it; a turn up brings it back.
    if (y <= anchorY && anchorY - y <= TURN_PX) return;
    if (y < anchorY) set(false);
  } else if (y - anchorY > TUCK_PX) set(true);
  else if (y >= anchorY && peakY - y <= TURN_PX) {
    peakY = Math.max(peakY, y);
    return;
  }
  anchorAt(y);
}

/**
 * The page's scroll listener is installed for the first bar and removed with
 * the last, and the state starts over then: a page with no bar left has no
 * direction to remember, and a stale "tucked" would greet the next one.
 */
function register(): () => void {
  if (bars === 0) {
    anchorAt(window.scrollY);
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
 * Brings the chrome back without a scroll: a tap on the pill, focus moving
 * into a bar, or a new screen. The next scroll down tucks it again, measured
 * from here.
 */
export function revealChrome(): void {
  anchorAt(window.scrollY);
  set(false);
}
