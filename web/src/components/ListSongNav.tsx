import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ListMusic } from "lucide-react";

import { cardChrome, cardHover } from "./cardStyles";
import { cn } from "@/lib/cn";
import type { ListPosition, ListStep } from "@/lib/listContext";
import { modalIsOpen } from "@/lib/modal";
import { startsClearOfEdges, swipeDirection } from "@/lib/swipe";

/*
 * Moving through a list without leaving it.
 *
 * Three ways through one list, because they are reached differently: the bar is
 * there before the song is read, the swipe is under the thumb while it is being
 * read on a phone, and the footer is what the end of long lyrics arrives at. The
 * two that can be pressed are <Link>s rather than buttons — the destination is a
 * URL, so opening a neighbor in a new tab, and everything else a browser does
 * with links, comes for free.
 *
 * Nothing here builds an address. A step arrives with its own href (see
 * `lib/listContext`), so the list cannot be dropped from the URL on the way
 * down — the one failure that would leave a reader out of the list with the page
 * looking perfectly correct.
 *
 * Steps are pushed rather than replaced, so the back gesture — and the Back
 * button, which is the same thing — walks back through the songs the reader came
 * through, one at a time, and out to the list at the end of them. The cost is
 * accepted deliberately: twenty steps forward is twenty entries to come back
 * through, and the list's own name in the bar is the one press that skips them.
 */

// The chrome of the bar's arrows. Deliberately not `rowControlChrome`, whose
// geometry is identical: it rests at `text-stone-400` where these rest a shade
// darker, and `cn` is a plain join, so both colors would land in the list and
// CSS source order — not the caller — would pick the winner.
const stepChrome =
  "shrink-0 rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200";

/**
 * The list a song is being read from, where it sits in it, and the way on.
 *
 * The list's name is a link back to it, which is the only way out for someone
 * who arrived on a shared link with no history to go back through.
 */
export function ListSongNavBar({ position }: { position: ListPosition }) {
  useArrowKeyPaging(position);

  return (
    <nav
      aria-label="Song navigation"
      className={cn(
        cardChrome,
        "mb-5 flex items-center gap-2 bg-white px-3 py-1.5 dark:bg-stone-900",
      )}
    >
      <Link
        to={position.listHref}
        className="flex min-w-0 items-center gap-2 text-sm text-stone-600 transition-colors hover:text-brand-600 dark:text-stone-400 dark:hover:text-brand-400"
      >
        <ListMusic aria-hidden className="size-4 shrink-0" />
        <span className="truncate font-medium">{position.listName}</span>
      </Link>

      <span className="ml-auto shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">
        {position.index + 1} of {position.total}
      </span>

      <StepArrow step={position.previous} back />
      <StepArrow step={position.next} />
    </nav>
  );
}

/**
 * One arrow of the bar, or the space it would take up at either end of a list.
 *
 * The placeholder keeps the bar from reflowing as a reader reaches the ends. It
 * is hidden from screen readers rather than rendered as a disabled link — an
 * anchor cannot be disabled, and a link to nowhere is worse than no link — and
 * it borrows only the sizing it exists for, since the rest of `stepChrome` is a
 * hover state, and a dead arrow that lights up under the pointer reads as a
 * control that has stopped working.
 */
function StepArrow({ step, back }: { step?: ListStep; back?: boolean }) {
  const Icon = back ? ChevronLeft : ChevronRight;

  if (!step) {
    return (
      <span aria-hidden className="shrink-0 p-2 opacity-30">
        <Icon className="size-5" />
      </span>
    );
  }

  return (
    <Link to={step.href} aria-label={back ? "Previous song" : "Next song"} className={stepChrome}>
      <Icon aria-hidden className="size-5" />
    </Link>
  );
}

/** How long the mark stays before fading, and where having shown it is recorded. */
const HINT_VISIBLE_MS = 3500;
const HINT_SEEN_KEY = "lyrics:swipe-hint-seen";

// Anything that owns the raw input landing on it. The two gestures below ask
// different questions of the same idea — a field owns its arrow keys for the
// caret, while every control owns a press — so the inner set is named once and
// the wider one is built from it. Written twice, a field-like thing added to one
// list and missed on the other fails silently, and typing in it pages the song.
const FIELDS = 'input, textarea, select, [contenteditable]';
const INTERACTIVE = `a, button, label, iframe, [role="button"], ${FIELDS}`;

/**
 * The swipe that pages through the list, and the one mark that says it is there.
 *
 * A story's gesture, read across the whole song rather than on a region of it —
 * which is the pivot away from what used to be here. The first version of this
 * was a pair of tap strips: invisible boxes down the edges of the page, then
 * down the edges of the lyrics, standing in for previous and next. A strip takes
 * every press in the box it is given, so each one had to be kept clear of every
 * control on the page — and it went wrong twice, both times only on a phone. A
 * near miss became a navigation, and a slightly-off tap on a small control was
 * taken outright, because touch adjustment weighs every clickable candidate
 * under the contact patch rather than the one point beneath its center.
 *
 * A swipe cannot fail that way, and that is the whole reason for it: it is read
 * from a movement of 60px or more, so it is not something a press can be
 * mistaken for. Nothing is laid over the page, nothing has to be lifted clear of
 * anything, and there is no allowlist to keep right in two places. The song page
 * is back to having no invisible targets on it at all.
 *
 * The gesture stays out of the browser's way rather than fighting it, which is
 * `lib/swipe`'s two rules: it must start clear of both screen edges, which
 * belong to Safari's back and forward and to Android's back, and it must be
 * decidedly horizontal, since reading a song is the same gesture with the axes
 * swapped.
 */
export function ListSongSwipe({
  position,
  surface,
}: {
  position: ListPosition;
  surface: RefObject<HTMLElement | null>;
}) {
  const hint = useRef<HTMLDivElement>(null);
  useSwipePaging(position, surface);
  const hinting = useSwipeHint(hint);

  // Nothing left to draw: a reader past their one showing has already been told,
  // and a list of one has nowhere to swipe to. Both after the hooks, which is
  // what keeps this honest rather than conditional — and the gesture is
  // installed by one of them, so it outlives the mark by design. Rendering a
  // spent mark anyway would leave an invisible fixed box over every song page
  // for good, which is the shape of thing this page has just got rid of.
  if (hinting === null) return null;
  if (!position.previous && !position.next) return null;

  return (
    <div
      ref={hint}
      aria-hidden
      // Fixed, because the gesture is the whole song and not a part of it: a
      // mark that has to be scrolled to is a mark for something nobody has found
      // yet. bottom-24 rests it in thumb reach and clear of the tab bar, the
      // same allowance the page itself makes for it.
      //
      // `md:hidden` is also what keeps the single showing from being spent at a
      // desk, where the arrows and the footer are the way through and there is
      // no swipe to explain: a hidden element has no box, so it never comes into
      // view and `useSwipeHint` never fires. Which matters most on the machines
      // that are both — a tablet in landscape spends nothing, and has the mark
      // waiting when it is turned.
      className="pointer-events-none fixed inset-x-0 bottom-24 z-30 flex justify-center md:hidden"
    >
      {/* Opaque and inverted, because it floats over the lyrics: a translucent
          gray on gray is a gesture nobody can see, which is a gesture nobody
          finds. Only the arrows a reader actually has are drawn, so the ends of
          a list do not promise a step that is not there. */}
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full bg-stone-800/95 px-3 py-1.5 text-xs font-medium text-stone-100 shadow-lg transition-opacity duration-700",
          "dark:bg-stone-100/95 dark:text-stone-800",
          hinting ? "opacity-100" : "opacity-0",
        )}
      >
        {position.previous && <ChevronLeft className="size-4" />}
        Swipe through the list
        {position.next && <ChevronRight className="size-4" />}
      </span>
    </div>
  );
}

/**
 * Reads a swipe across the song, and takes the step it asks for.
 *
 * Every listener is passive and nothing here calls `preventDefault`: the gesture
 * is read after the movement rather than taken from it. That is what leaves a
 * long song's vertical scroll completely alone — the failure `touch-none` would
 * have caused, and one that a desktop, where a mouse has no such conflict, never
 * shows.
 *
 * The gesture is claimed or dropped at the moment the finger goes down, where
 * all four of its guards therefore live.
 */
function useSwipePaging(position: ListPosition, surface: RefObject<HTMLElement | null>): void {
  const navigate = useNavigate();
  // The hrefs rather than the steps, for the reason `useArrowKeyPaging` gives
  // below: `position` is rebuilt on every render, so holding it would rebuild
  // these listeners on every re-render the page has.
  const previousHref = position.previous?.href;
  const nextHref = position.next?.href;

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    if (!previousHref && !nextHref) return;

    /** Where the finger went down, or null when this touch is not a candidate. */
    let from: { x: number; y: number; at: number; collapsed: boolean } | null = null;

    const forget = () => {
      from = null;
    };

    const onStart = (event: TouchEvent) => {
      from = null;

      // A second finger is a pinch or a zoom, and the page belongs to that.
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (!touch) return;
      if (!startsClearOfEdges(touch.clientX, window.innerWidth)) return;

      // An open sheet owns the gestures over it, as it owns the arrow keys, and
      // for the same reason: paging the song out from under one reads as a bug
      // in the sheet. Asked of the DOM rather than of this page, so the next
      // sheet is covered without anyone having to add it to a list.
      if (modalIsOpen()) return;

      // Belt and braces, and deliberately the safe way round: a swipe that
      // starts on a control does nothing, rather than a control being
      // unreachable under the gesture — the inversion of the tap strips this
      // replaced. Browsers already drop the click a moving touch would have
      // synthesized, so this rarely has anything to do.
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;

      from = {
        x: touch.clientX,
        y: touch.clientY,
        at: event.timeStamp,
        collapsed: selectionIsCollapsed(),
      };
    };

    const onMove = (event: TouchEvent) => {
      // A second finger arriving partway through, which the gesture above was
      // only ever the beginning of.
      if (event.touches.length > 1) forget();
    };

    const onEnd = (event: TouchEvent) => {
      const start = from;
      from = null;
      if (!start) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      // The movement selected text: a long press and a drag sideways, which ends
      // exactly where a swipe ends and means the opposite of leaving. Compared
      // against how the gesture started rather than simply read, so a selection
      // made earlier and left on the page cannot quietly kill every swipe after
      // it.
      if (start.collapsed && !selectionIsCollapsed()) return;

      const direction = swipeDirection(
        touch.clientX - start.x,
        touch.clientY - start.y,
        event.timeStamp - start.at,
      );
      if (!direction) return;

      // Nothing at this end of the list, so the swipe is simply over. Nothing
      // has to be undone: the event was never claimed.
      const href = direction === "next" ? nextHref : previousHref;
      if (!href) return;

      navigate(href);
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
  }, [navigate, nextHref, previousHref, surface]);
}

/** Whether nothing on the page is selected. A missing selection is none. */
function selectionIsCollapsed(): boolean {
  const selection = window.getSelection();
  return !selection || selection.isCollapsed;
}

/**
 * Shows the mark once, the first time it is really on screen.
 *
 * A swipe has nothing visible about it, so something has to say that it is
 * there. Shown on arrival at every song it would be a flash on every step, which
 * is a decoration arguing with the reading surface it sits on; shown never, the
 * gesture is found by accident or not at all. Once per device, and then the page
 * is left alone.
 *
 * The observer is what asks whether the mark is on screen *at all*, which is the
 * question that matters: the mark is fixed, so on a phone it is in view the
 * moment it is rendered, and at a desk `md:hidden` gives it no box to be in view
 * with. That is the whole reason this is not a timer — a timer would spend the
 * one showing on a screen that never displayed it, and the reader who turns a
 * tablet to portrait afterwards would never be told about the gesture at all.
 *
 * Recorded when it is shown rather than when it finishes, so a reader who steps
 * on mid-fade is not shown it again on the next song.
 *
 * Answers null once that showing is spent, which is the caller's cue to render
 * nothing at all: there is then nothing to observe and nothing to draw.
 */
function useSwipeHint(mark: RefObject<HTMLElement | null>): boolean | null {
  // Read at render rather than inside the effect, the same lazy read the
  // reader's font size makes, because the answer decides whether there is
  // anything to render at all — and it cannot change under a mounted page, since
  // this hook is the only writer.
  const [unspent] = useState(() => localStorage.getItem(HINT_SEEN_KEY) === null);
  const [hinting, setHinting] = useState(false);

  useEffect(() => {
    const element = mark.current;
    if (!element || !unspent) return;

    let fade: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;

      observer.disconnect();
      localStorage.setItem(HINT_SEEN_KEY, "1");
      setHinting(true);
      fade = setTimeout(() => setHinting(false), HINT_VISIBLE_MS);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      clearTimeout(fade);
    };
  }, [mark, unspent]);

  return unspent ? hinting : null;
}

/**
 * The songs on either side, named, where long lyrics end.
 *
 * The bar has scrolled away by the time a reader reaches here, and the swipe that
 * replaced it says nothing about what it leads to. This is the one place with the
 * room to name both.
 *
 * A list of one has neither, and the empty rule its border would draw under the
 * lyrics reads as a section that failed to load. The bar stays in that case: "1
 * of 1" and a link to the list is still the way back for a shared link.
 */
export function ListSongNavFooter({ position }: { position: ListPosition }) {
  if (!position.previous && !position.next) return null;

  return (
    <nav
      aria-label="More from this list"
      className="mt-10 grid gap-2 border-t border-stone-200 pt-5 sm:grid-cols-2 dark:border-stone-800"
    >
      <StepCard step={position.previous} back />
      <StepCard step={position.next} />
    </nav>
  );
}

function StepCard({ step, back }: { step?: ListStep; back?: boolean }) {
  if (!step) return null;

  const Icon = back ? ChevronLeft : ChevronRight;

  return (
    <Link
      to={step.href}
      className={cn(
        cardChrome,
        cardHover,
        "flex items-center gap-2 px-3 py-3",
        // The second column is claimed rather than left to auto-placement, which
        // only puts it there when there is a step back to fill the first — so on
        // the opening song the way forward would otherwise slide across to where
        // a way back would have been. A no-op in every other case.
        back ? undefined : "justify-end text-right sm:col-start-2",
      )}
    >
      {back && <Icon aria-hidden className="size-5 shrink-0 text-stone-400" />}
      <span className="min-w-0">
        <span className="block text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
          {back ? "Previous" : "Next"}
        </span>
        <span className="block truncate font-medium">{step.title}</span>
      </span>
      {!back && <Icon aria-hidden className="size-5 shrink-0 text-stone-400" />}
    </Link>
  );
}

/**
 * Arrow keys, for reading a list at a desk.
 *
 * Left and right rather than up and down, which scroll the lyrics. A modifier
 * means the browser's own shortcut — alt-arrow is history — and a focused field
 * owns its arrows for the caret, so both are left alone.
 *
 * An open sheet owns them too, and that is asked of the DOM rather than of the
 * page: a list of the page's sheets is a list that the next sheet is not on, and
 * arrow keys paging the song out from under an open one looks like a bug in the
 * sheet. `Sheet` is the only modal there is and it always marks itself, so one
 * question covers every sheet there will be.
 */
function useArrowKeyPaging(position: ListPosition): void {
  const navigate = useNavigate();
  // The hrefs rather than the steps: `position` is built during render, so it is
  // a new object every time and would rebuild the listener on every re-render
  // the page has — changing the text size, a query settling. Two strings and
  // `navigate` also keep what the listener holds for the life of the window down
  // to what it reads.
  const previousHref = position.previous?.href;
  const nextHref = position.next?.href;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const target = event.target;
      if (target instanceof HTMLElement && target.closest(FIELDS)) return;
      if (modalIsOpen()) return;

      const href = event.key === "ArrowLeft" ? previousHref : nextHref;
      if (!href) return;

      // Claimed only once the key is actually being acted on, and every guard
      // above has returned instead. A left or right arrow still scrolls the
      // document sideways by default, so without this a song whose lyrics
      // overflow the column pages *and* scrolls on one press.
      event.preventDefault();
      navigate(href);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, nextHref, previousHref]);
}
