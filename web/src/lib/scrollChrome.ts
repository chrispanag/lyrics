import { useEffect } from "react";

/*
 * Whether a phone's chrome is tucked away: the top bars hidden and the bottom
 * bar shrunk to its small pill. Tucked once the reader has scrolled down a
 * little way, back on any scroll up, at the top and the end of the page, and
 * whenever something asks (a tap on the pill, focus moving into a bar, a new
 * screen).
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
 * How far up brings it back: little, since a reader reaching for the bars
 * scrolls up a touch and expects them at once. Less than this is
 * momentum-scroll jitter.
 */
const REVEAL_PX = 8;

/** Within this of the top, the chrome is always out: there is nothing to give room to. */
const TOP_PX = 80;

/**
 * Within this of the end, the chrome is out too, as Safari's toolbar is: the
 * reader has finished and the tabs are what comes next. It also keeps iOS's
 * bounce at the end, which reads as a short scroll up, from flicking it out.
 */
const END_PX = 24;

let tucked = false;
/**
 * Where the current stretch started: the last turn against the way the chrome
 * is drawn (a step down while tucked, a step up while out), so each threshold
 * counts from the turn, however slowly the reader got there.
 */
let anchorY = 0;
/** The offset at the last event, to tell which way this one went. */
let lastY = 0;
let bars = 0;

/** Starts the count over from where the page is. */
function anchorAt(y: number): void {
  anchorY = y;
  lastY = y;
}

function set(next: boolean): void {
  if (next === tucked) return;
  tucked = next;
  document.documentElement.toggleAttribute(CHROME_TUCKED_ATTRIBUTE, next);
}

/** Whether `y` is at the end of a page that scrolls at all. */
function atEnd(y: number): boolean {
  const end = document.documentElement.scrollHeight - window.innerHeight;
  return end > 0 && y >= end - END_PX;
}

function onScroll(): void {
  const y = window.scrollY;
  if (y <= TOP_PX || atEnd(y)) {
    set(false);
    anchorAt(y);
    return;
  }
  if (tucked ? y > lastY : y < lastY) {
    anchorAt(y);
    return;
  }
  if (tucked ? anchorY - y > REVEAL_PX : y - anchorY > TUCK_PX) {
    set(!tucked);
    anchorAt(y);
    return;
  }
  lastY = y;
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
