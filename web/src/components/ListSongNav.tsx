import { useEffect, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight, ListMusic } from "lucide-react";

import { cardChrome } from "./cardStyles";
import { cn } from "@/lib/cn";
import type { ListPosition } from "@/lib/listContext";
import { FIELDS, modalIsOpen } from "@/lib/modal";
import { startsClearOfEdges, swipeDirection } from "@/lib/swipe";
import { Link, useRouter } from "@/lib/navigation";
import { useStoredState } from "@/lib/useStoredState";

/*
 * Moving through a list without leaving it: the bar's arrows (links, so a
 * neighbor can be opened in a new tab), the arrow keys and the swipe.
 *
 * Nothing here builds an address; each step arrives with its href from
 * `lib/listContext`, so `?list=` cannot be dropped.
 *
 * Every step *replaces* its history entry (each of the three separately, so each
 * is pinned separately), leaving Back as the way out of the list. The list's
 * name is the exception and pushes. See "Frontend" in CLAUDE.md.
 */

// Not `rowControlChrome`: its resting color differs, and `cn` cannot override.
const stepChrome =
  "shrink-0 rounded-compact p-2 text-fg-muted transition-colors hover:bg-subtle hover:text-fg";

/**
 * The list a song is being read from, where it sits in it, and the way on.
 * The list's name links back to it: the only way out from a shared link.
 *
 * Drawn only while the list is not beside the song. From `@3xl` the list pane
 * says all of it, the open song marked in it, so the bar is hidden there; the
 * keys and the neighbors' prefetch stay, since they hang on this component and
 * not on its box.
 */
export function ListSongNavBar({ position }: { position: ListPosition }) {
  useArrowKeyPaging(position);
  usePrefetchedSteps(position);

  return (
    <nav
      aria-label="Song navigation"
      className={cn(
        cardChrome,
        "mb-5 flex items-center gap-2 bg-surface px-3 py-1.5 @3xl/app:hidden",
      )}
    >
      <Link
        href={position.listHref}
        className="flex min-w-0 items-center gap-2 text-sm text-fg-tertiary transition-colors hover:text-fg-accent"
      >
        <ListMusic aria-hidden className="size-4 shrink-0" />
        <span className="truncate font-medium">{position.listName}</span>
      </Link>

      <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-muted">
        {position.index + 1} of {position.total}
      </span>

      <StepArrow href={position.previousHref} back />
      <StepArrow href={position.nextHref} />
    </nav>
  );
}

/**
 * One arrow of the bar, or an aria-hidden placeholder at either end of a list
 * so the bar does not reflow. The placeholder takes no hover state from
 * `stepChrome`: a dead arrow that lights up reads as a broken control.
 */
function StepArrow({ href, back }: { href?: string | undefined; back?: boolean | undefined }) {
  const Icon = back ? ChevronLeft : ChevronRight;

  if (!href) {
    return (
      <span aria-hidden className="shrink-0 p-2 opacity-30">
        <Icon className="size-5" />
      </span>
    );
  }

  return (
    <Link
      href={href}
      replace
      aria-label={back ? "Previous song" : "Next song"}
      className={stepChrome}
    >
      <Icon aria-hidden className="size-5" />
    </Link>
  );
}

/**
 * Loads both neighbors once the position is known, so whichever way the reader
 * steps (an arrow, a key, a swipe) the page paints at once rather than after a
 * server round trip. An effect rather than the arrows' own prefetch: a link's
 * waits for it to scroll into view, and the keys and the swipe must not depend
 * on where the bar is.
 */
function usePrefetchedSteps({ previousHref, nextHref }: ListPosition) {
  const { prefetch } = useRouter();
  useEffect(() => {
    if (previousHref) prefetch(previousHref);
    if (nextHref) prefetch(nextHref);
  }, [prefetch, previousHref, nextHref]);
}

/** How long the mark stays before fading, and where having shown it is recorded. */
const HINT_VISIBLE_MS = 3500;
const HINT_SEEN_KEY = "lyrics:swipe-hint-seen";

/** Must match `duration-700` on the pill below, or the fade is cut short. */
const HINT_FADE_MS = 700;

// Fields own their arrow keys; every control owns a press. INTERACTIVE is built
// from FIELDS so a field added to one cannot be missed on the other.
const INTERACTIVE = `a, button, label, iframe, [role="button"], ${FIELDS}`;

/**
 * The swipe that pages through the list, and the one mark that says it is there.
 *
 * Read across the whole song, never as invisible tap targets: do not reintroduce
 * those (see "Frontend" in CLAUDE.md). `lib/swipe` keeps it clear of the
 * browser's edge gestures and of vertical scrolling.
 */
export function ListSongSwipe({
  position,
  surface,
}: {
  position: ListPosition;
  surface: RefObject<HTMLElement | null>;
}) {
  useSwipePaging(position, surface);
  const [hinting, markMounted] = useSwipeHint();

  // Nothing to draw: not read yet, already shown, or nowhere to swipe to. The
  // gesture is installed above, so it outlives the mark.
  if (hinting === null) return null;
  if (!position.previousHref && !position.nextHref) return null;

  return (
    <div
      ref={markMounted}
      aria-hidden
      // Fixed, so it is on screen without scrolling; bottom-12 matches the
      // shell's `pb-12`. `md:hidden` must stay on this observed box: a hidden
      // box never intersects, so the one showing is not spent at a desk.
      className="pointer-events-none fixed inset-x-0 bottom-12 z-floating flex justify-center md:hidden"
    >
      {/* Opaque and inverted so it reads over the lyrics; only available
          directions get an arrow. */}
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full bg-inverse/95 px-3 py-1.5 text-xs font-medium text-fg-inverse shadow-popover transition-opacity duration-700",
          hinting ? "opacity-100" : "opacity-0",
        )}
      >
        {position.previousHref && <ChevronLeft className="size-4" />}
        Swipe through the list
        {position.nextHref && <ChevronRight className="size-4" />}
      </span>
    </div>
  );
}

/**
 * Reads a swipe across the song, and takes the step it asks for.
 *
 * Every listener is passive and nothing calls `preventDefault`, so vertical
 * scroll is untouched. Most guards run at touchstart; a second finger and a
 * changed selection are checked on move and end.
 */
function useSwipePaging(position: ListPosition, surface: RefObject<HTMLElement | null>): void {
  const router = useRouter();
  // The strings, not `position`, which is a new object every render and would
  // rebuild the listeners each time.
  const { previousHref, nextHref } = position;

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    if (!previousHref && !nextHref) return;

    /** Where the finger went down, or null when this touch is not a candidate. */
    let from: { x: number; y: number; at: number; selected: string } | null = null;

    const forget = () => {
      from = null;
    };

    const onStart = (event: TouchEvent) => {
      from = null;

      // A second finger is a pinch or a zoom, and the page belongs to that.
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (!touch) return;
      if (!startsClearOfEdges(touch.clientX, window.innerWidth)) return;

      // An open modal owns the gestures over it.
      if (modalIsOpen()) return;

      // A swipe starting on a control does nothing, so no control is ever
      // unreachable under the gesture.
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;

      from = {
        x: touch.clientX,
        y: touch.clientY,
        at: event.timeStamp,
        selected: selectedText(),
      };
    };

    const onMove = (event: TouchEvent) => {
      // A second finger arriving partway through.
      if (event.touches.length > 1) forget();
    };

    const onEnd = (event: TouchEvent) => {
      const start = from;
      from = null;
      if (!start) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      // The movement changed the selection (a long-press drag or a handle
      // drag). Compared with the start, not "is anything selected": that misses
      // extending a selection and lets a stale one kill every swipe.
      if (selectedText() !== start.selected) return;

      const direction = swipeDirection(
        touch.clientX - start.x,
        touch.clientY - start.y,
        event.timeStamp - start.at,
      );
      if (!direction) return;

      const href = direction === "next" ? nextHref : previousHref;
      if (!href) return;

      router.replace(href);
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: true });
    element.addEventListener("touchend", onEnd, { passive: true });
    element.addEventListener("touchcancel", forget, { passive: true });

    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", forget);
    };
  }, [router, nextHref, previousHref, surface]);
}

/** What is selected on the page, as text. Nothing selected is "". */
function selectedText(): string {
  return window.getSelection()?.toString() ?? "";
}

/**
 * Whether this device still has its one showing of the mark, and spending it.
 * Storage access can throw; a refusal reads as spent so the two halves agree
 * and the mark is not shown on every song.
 */
function hintUnspent(): boolean {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) === null;
  } catch {
    return false;
  }
}

function spendHint(): void {
  try {
    localStorage.setItem(HINT_SEEN_KEY, "1");
  } catch {
    // The read above answers "spent" here too.
  }
}

/**
 * Shows the mark once per device, the first time an IntersectionObserver sees
 * it on screen (not on a timer, which would spend it at a desk where the mark
 * has no box). Recorded when shown, not when the fade ends.
 *
 * Answers null when there is nothing to draw: before storage is read, once
 * spent, and after the fade.
 */
function useSwipeHint(): [boolean | null, (element: HTMLElement | null) => void] {
  // Starts spent: this decides markup, so a server must answer the same. Read
  // once, not subscribed to: spending the hint must not unmount the mark mid-fade.
  const [unspent] = useStoredState(false, hintUnspent);
  const [hinting, setHinting] = useState(false);
  const [over, setOver] = useState(false);
  // State, not a ref: the mark can mount after the first render (a list gaining
  // a second song), and the effect must re-run when it does.
  const [mark, setMark] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!mark || !unspent) return;

    let fade: ReturnType<typeof setTimeout> | undefined;
    let done: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;

      observer.disconnect();
      spendHint();
      setHinting(true);
      fade = setTimeout(() => {
        setHinting(false);
        done = setTimeout(() => setOver(true), HINT_FADE_MS);
      }, HINT_VISIBLE_MS);
    });
    observer.observe(mark);

    return () => {
      observer.disconnect();
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [mark, unspent]);

  return [unspent && !over ? hinting : null, setMark];
}

/**
 * Left and right arrow keys, for reading a list at a desk. Modified keys,
 * focused fields and open modals are left alone.
 */
function useArrowKeyPaging(position: ListPosition): void {
  const router = useRouter();
  // The strings, not `position`; see `useSwipePaging`.
  const { previousHref, nextHref } = position;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const target = event.target;
      if (target instanceof HTMLElement && target.closest(FIELDS)) return;
      if (modalIsOpen()) return;

      const href = event.key === "ArrowLeft" ? previousHref : nextHref;
      if (!href) return;

      // Otherwise overflowing lyrics also scroll sideways on the same press.
      event.preventDefault();
      router.replace(href);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, nextHref, previousHref]);
}
