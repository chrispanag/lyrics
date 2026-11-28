import { type RefObject, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { type ListPosition, positionLabel } from "@/lib/listContext";
import { FIELDS, modalIsOpen } from "@/lib/modal";
import { startsClearOfEdges, swipeDirection } from "@/lib/swipe";
import { Link, useRouter } from "@/lib/navigation";
import type { Song } from "@/lib/types";

/*
 * Reading through a list without leaving it. A book's way: a running head
 * that says which list and where in it (`ListPlace`, the song's Back), and a
 * page turn at the foot of the song (`ListPageTurn`, links, so a neighbor can
 * be opened in a new tab). Then the ways that draw nothing (`ListPaging`): the
 * arrow keys, the swipe, and the neighbors loaded ahead.
 *
 * Nothing here builds an address; each step arrives with its href from
 * `lib/listContext`, so `?list=` cannot be dropped.
 *
 * Every step *replaces* its history entry (each of the three ways separately,
 * so each is pinned separately), leaving Back as the way out of the list. See
 * "Frontend" in CLAUDE.md.
 */

/**
 * What the song's Back says while it is read from a list: the list's name and
 * the place in it, as a book's running head does ("Ρεμπέτικα · 2 of 3"). Back
 * leads to the list: the one behind the song, or, from a shared link, the one
 * above it (`upHref`). Its name stays "Back to …", so it still reads as Back.
 */
export function ListPlace({ position }: { position: ListPosition }) {
  return (
    <>
      {/* The spaces keep the words apart in the accessible name, where the
          row's gap does not reach: "Back to Ρεμπέτικα 2 of 3". */}
      <span className="sr-only">Back to</span>{" "}
      <span className="min-w-0 truncate font-medium">{position.listName}</span>{" "}
      <span aria-hidden className="text-fg-muted">
        ·
      </span>{" "}
      <span className="shrink-0 tabular-nums text-fg-muted">{positionLabel(position)}</span>
    </>
  );
}

/**
 * The page turn at the foot of a song read from a list: the previous song and
 * the next, each by its title. Nothing at all on a list of one.
 */
export function ListPageTurn({ position }: { position: ListPosition }) {
  const { previousHref, previousSong, nextHref, nextSong } = position;
  if (!previousHref && !nextHref) return null;

  return (
    <nav
      aria-label="Song navigation"
      className="mt-12 grid grid-cols-2 gap-4 border-t border-line pt-3"
    >
      {previousHref && <PageTurn href={previousHref} song={previousSong} back />}
      {nextHref && <PageTurn href={nextHref} song={nextSong} />}
    </nav>
  );
}

/**
 * One side of the page turn: which way, and the song's title in the song's
 * own serif and language. The next song sits in the right-hand column even
 * when there is no previous one.
 */
function PageTurn({
  href,
  song,
  back,
}: {
  href: string;
  song: Song | undefined;
  back?: boolean | undefined;
}) {
  const Icon = back ? ChevronLeft : ChevronRight;
  return (
    <Link
      href={href}
      replace
      className={cn(
        "group flex min-w-0 flex-col gap-0.5 rounded-control py-2",
        back ? "items-start text-left" : "col-start-2 items-end text-right",
      )}
    >
      <span className="flex items-center gap-0.5 text-sm text-fg-tertiary">
        {back && <Icon aria-hidden className="size-4" />}
        {back ? "Previous" : "Next"}
        {!back && <Icon aria-hidden className="size-4" />}
      </span>{" "}
      {song && (
        <span
          lang={song.language}
          className="max-w-full truncate font-lyrics text-lg font-semibold text-fg transition-colors group-hover:text-fg-accent"
        >
          {song.title}
        </span>
      )}
    </Link>
  );
}

/**
 * The ways through a list that draw nothing: the arrow keys, the swipe across
 * `surface`, and both neighbors loaded ahead. At every width: beside the list
 * a desk keeps the keys, and a touch tablet the swipe.
 */
export function ListPaging({
  position,
  surface,
}: {
  position: ListPosition;
  surface: RefObject<HTMLElement | null>;
}) {
  useArrowKeyPaging(position);
  usePrefetchedSteps(position);
  useSwipePaging(position, surface);
  return null;
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

// Fields own their arrow keys; every control owns a press. INTERACTIVE is built
// from FIELDS so a field added to one cannot be missed on the other.
const INTERACTIVE = `a, button, label, iframe, [role="button"], ${FIELDS}`;

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
