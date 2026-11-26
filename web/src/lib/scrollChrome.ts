import { type RefObject, useEffect } from "react";

/*
 * How far a phone's chrome is tucked away: the top bars hidden and the bottom
 * bar shrunk to its small pill. Tucked once the reader has scrolled down a
 * little way, back on a scroll up, at the top of the page, and whenever
 * something asks (a tap on the pill, focus moving into a bar, a new screen).
 *
 * One answer for the whole page, so every bar moves on the same scroll. Each
 * bar listening for itself would start counting from wherever the page was
 * when it mounted, and a song's top bar and the bottom bar could then disagree
 * about which way the reader last went.
 *
 * The answer comes in two forms, neither of them React state: the chrome moves
 * over and over in a read, and drawing it through React would re-render each
 * bar and the page holding one, for a change that is only a transform.
 *
 * - `data-chrome-tucked` on <html>: tucked or not. The top bars slide by it,
 *   and it decides which of the bottom bar's tabs and pill takes presses.
 * - `--chrome-scroll-progress` on a bar that follows it (the bottom bar): how far
 *   tucked, from 0 to 1. While the reader scrolls it follows the scroll pixel
 *   for pixel over `RANGE_PX`, as Safari's toolbar does, with
 *   `data-chrome-scrubbing` on the bar so index.css does not ease it. Once the
 *   scroll comes to rest it settles at one end or the other, which index.css
 *   eases. Under reduced motion index.css draws only the attribute.
 *   Written on the bar rather than <html>: a custom property changed on the
 *   root restyles the whole page, on every frame of a scroll.
 *
 * Below `md` only, but the store does not know that: each bar applies it under
 * `max-md:`, or is not on screen from `md` up at all, so nothing here has to
 * follow a window resized across the breakpoint.
 */

/** What index.css keys the tucked chrome on. */
export const CHROME_TUCKED_ATTRIBUTE = "data-chrome-tucked";

/** How far tucked, 0 out to 1 tucked, on each bar that follows the scroll. */
export const CHROME_PROGRESS_PROPERTY = "--chrome-scroll-progress";

/** On a bar following the scroll while the reader moves it, so index.css does not ease it. */
export const CHROME_SCRUBBING_ATTRIBUTE = "data-chrome-scrubbing";

/**
 * How far a scroll takes the chrome from out to tucked, or back. Also how far
 * the reader must go down before the top bars leave: a nudge while reading is
 * not a decision to read on.
 */
const RANGE_PX = 40;

/**
 * How far up brings tucked chrome out: little, since a reader reaching for the
 * bars scrolls up a touch and expects them. Less than this is momentum-scroll
 * jitter, or the fractional offsets of a phone's toolbar resizing, and leaves
 * the chrome tucked.
 */
const TURN_PX = 8;
const TURN = TURN_PX / RANGE_PX;

/**
 * Within this of the top the chrome is always out: there is nothing to give
 * room to. Below it the chrome tucks by no more than the reader has scrolled
 * past it, so it starts to shrink from here rather than jumping.
 */
const TOP_PX = 80;

/**
 * How long without a scroll event counts as the scroll coming to rest, where
 * the browser does not say so with `scrollend`. Momentum scrolling keeps
 * firing scroll events, so this is only ever the gap between two of them.
 */
const SETTLE_MS = 150;

let tucked = false;
/** 0 out to 1 tucked: anywhere between while scrubbing, at rest 0 or 1. */
let progress = 0;
let scrubbing = false;
let lastY = 0;
let goingDown = false;
/** A finger on the screen holds the chrome where the scroll left it, as Safari does. */
let touching = false;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let bars = 0;
const followers = new Set<HTMLElement>();

function setTucked(next: boolean): void {
  if (next === tucked) return;
  tucked = next;
  document.documentElement.toggleAttribute(CHROME_TUCKED_ATTRIBUTE, next);
}

function draw(bar: HTMLElement): void {
  bar.style.setProperty(CHROME_PROGRESS_PROPERTY, String(progress));
  bar.toggleAttribute(CHROME_SCRUBBING_ATTRIBUTE, scrubbing);
}

function drawAll(): void {
  for (const bar of followers) draw(bar);
}

/**
 * Whether `y` is past the end of a page that scrolls at all: iOS's bounce,
 * whose way back reads as a scroll up and would bring the chrome out, and
 * whose way out would tuck it. The `overscroll-behavior` in index.css is on
 * <body>, which the spec does not carry to the page's own scroller, so it is
 * not counted on to stop the bounce.
 */
function pastEnd(y: number): boolean {
  const end = document.documentElement.scrollHeight - window.innerHeight;
  return end > 0 && y > end;
}

/*
 * The end of a page moves nothing: a flick that tucks the chrome on its way
 * down would bring it straight back on the bounce.
 */
function onScroll(): void {
  const y = window.scrollY;
  if (pastEnd(y)) return;
  const dy = y - lastY;
  lastY = y;
  if (dy === 0) return;
  goingDown = dy > 0;

  const ceiling = Math.min(1, Math.max(0, (y - TOP_PX) / RANGE_PX));
  const next = Math.min(ceiling, Math.max(0, progress + dy / RANGE_PX));
  if (next >= 1) setTucked(true);
  else if (!goingDown && next <= 1 - TURN) setTucked(false);

  // Scrolling on past either end changes nothing drawn.
  if (next !== progress || !scrubbing) {
    progress = next;
    scrubbing = true;
    drawAll();
  }
  scheduleSettle();
}

/**
 * Where the chrome comes to rest once the scroll does, by the way the reader
 * last went: on the way down, tucked from halfway; on the way up, out after a
 * touch.
 */
function settle(): void {
  clearTimeout(settleTimer);
  if (!scrubbing) return;
  const next = goingDown ? progress >= 0.5 : progress > 1 - TURN;
  setTucked(next);
  progress = Number(next);
  scrubbing = false;
  drawAll();
}

function scheduleSettle(): void {
  clearTimeout(settleTimer);
  if (!touching) settleTimer = setTimeout(settle, SETTLE_MS);
}

function onScrollEnd(): void {
  if (!touching) settle();
}

function onTouchStart(): void {
  touching = true;
  clearTimeout(settleTimer);
}

function onTouchEnd(): void {
  touching = false;
  scheduleSettle();
}

const listeners: [string, () => void][] = [
  ["scroll", onScroll],
  ["scrollend", onScrollEnd],
  ["touchstart", onTouchStart],
  ["touchend", onTouchEnd],
  ["touchcancel", onTouchEnd],
];

/**
 * Brings the chrome back without a scroll: a tap on the pill, focus moving
 * into a bar, or a new screen. Out, with nothing in flight, and the next
 * scroll down tucks it again, measured from here.
 */
export function revealChrome(): void {
  clearTimeout(settleTimer);
  lastY = window.scrollY;
  progress = 0;
  scrubbing = false;
  setTucked(false);
  drawAll();
}

/**
 * The page's listeners are installed for the first bar and removed with the
 * last, and the state starts over then: a page with no bar left has no
 * direction to remember, and a stale "tucked" would greet the next one.
 */
function register(): () => void {
  if (bars === 0) {
    touching = false;
    revealChrome();
    for (const [type, listener] of listeners) {
      window.addEventListener(type, listener, { passive: true });
    }
  }
  bars += 1;
  return () => {
    bars -= 1;
    if (bars > 0) return;
    for (const [type, listener] of listeners) window.removeEventListener(type, listener);
    revealChrome();
  };
}

/**
 * Takes part in the page's tucking, for a bar index.css moves with it. In an
 * effect, so a server and the first render in a browser draw the chrome out.
 * Returns nothing: the bar re-renders for none of it.
 *
 * `follower` is a bar drawn from the progress rather than the attribute alone:
 * `--chrome-scroll-progress` and `data-chrome-scrubbing` are written to it.
 */
export function useChromeScroll(follower?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const unregister = register();
    const bar = follower?.current;
    if (bar) {
      followers.add(bar);
      draw(bar);
    }
    return () => {
      if (bar) followers.delete(bar);
      unregister();
    };
  }, [follower]);
}

/**
 * Back to the top of the page, with the chrome out: a tap on the tab already
 * lit, as a phone's own apps do. Smooth, or a jump for a reader who asks for
 * less motion, by the root's `scroll-behavior` (index.css). The chrome comes
 * out at once rather than on the scroll's first steps, so the tap is answered
 * where it was made.
 */
export function scrollToTop(): void {
  window.scrollTo({ top: 0 });
  revealChrome();
}
