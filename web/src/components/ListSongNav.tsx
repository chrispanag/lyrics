import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ListMusic } from "lucide-react";

import { cardChrome } from "./cardStyles";
import { cn } from "@/lib/cn";
import type { ListPosition } from "@/lib/listContext";
import { modalIsOpen } from "@/lib/modal";
import { startsClearOfEdges, swipeDirection } from "@/lib/swipe";

/*
 * Moving through a list without leaving it.
 *
 * Three ways through one list, because they are reached differently: the bar's
 * arrows are on screen before the song is read, the arrow keys are under the
 * hands at a desk, and the swipe is under the thumb on a phone. Only the first
 * is something to press, and those are <Link>s rather than buttons — the
 * destination is a URL, so opening a neighbor in a new tab, and everything else
 * a browser does with links, comes for free.
 *
 * Nothing here builds an address. A step arrives with its own href (see
 * `lib/listContext`), so the list cannot be dropped from the URL on the way
 * down — the one failure that would leave a reader out of the list with the page
 * looking perfectly correct.
 *
 * Every step *replaces* the entry it leaves rather than pushing onto it — all
 * three of them, each saying so in its own way, which is why each is pinned on
 * its own — so the trail behind a reader is the one they walked to get into the
 * list and not the songs they have read since. Back — the browser's, the
 * gesture, and the page's own button, which are all the same history — therefore
 * leaves the list for whatever the song was opened from. Pushing was the earlier
 * answer and the cost was not worth it: the way out of a twenty-song list was
 * twenty presses of one control, each landing on a song page that looks like the
 * one before, with nothing on screen to say how many were left. Moving inside
 * the list is what the bar and the swipe are for; Back is the way out of it.
 *
 * The list's own name is the exception and pushes, being a link to another page
 * rather than a step through this one. Replacing there would leave a reader who
 * arrived from that list holding two identical entries in a row, and a Back press
 * that appears not to move — the duplicate-entry trap the editor's own way out
 * documents.
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

      <StepArrow href={position.previousHref} back />
      <StepArrow href={position.nextHref} />
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
function StepArrow({ href, back }: { href?: string; back?: boolean }) {
  const Icon = back ? ChevronLeft : ChevronRight;

  if (!href) {
    return (
      <span aria-hidden className="shrink-0 p-2 opacity-30">
        <Icon className="size-5" />
      </span>
    );
  }

  // `replace` is this step's whole share of the rule at the top of the file, and
  // the one statement of it that is markup rather than a call.
  return (
    <Link
      to={href}
      replace
      aria-label={back ? "Previous song" : "Next song"}
      className={stepChrome}
    >
      <Icon aria-hidden className="size-5" />
    </Link>
  );
}

/** How long the mark stays before fading, and where having shown it is recorded. */
const HINT_VISIBLE_MS = 3500;
const HINT_SEEN_KEY = "lyrics:swipe-hint-seen";

/**
 * How long the fade takes, which is `duration-700` on the pill below.
 *
 * The mark is dropped after this rather than at the same moment, so the fade is
 * seen rather than cut — and a value that drifts under the class shortens the
 * fade to itself, which is the one frame of the mark a reader is most likely to
 * be watching.
 */
const HINT_FADE_MS = 700;

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
  useSwipePaging(position, surface);
  const [hinting, markMounted] = useSwipeHint();

  // Nothing to draw: the stored answer is not in yet, a reader past their one
  // showing has already been told, or a list of one has nowhere to swipe to.
  // All of them after the hooks, which is what keeps this honest rather than
  // conditional — and the gesture is installed by one of them, so it outlives
  // the mark by design. Rendering a spent mark anyway would leave an invisible
  // fixed box over every song page for good, which is the shape of thing this
  // page has just got rid of.
  if (hinting === null) return null;
  if (!position.previousHref && !position.nextHref) return null;

  return (
    <div
      ref={markMounted}
      aria-hidden
      // Fixed, because the gesture is the whole song and not a part of it: a
      // mark that has to be scrolled to is a mark for something nobody has found
      // yet. bottom-12 rests it in thumb reach, level with the allowance the
      // shell's own `pb-12` leaves at the foot of every page — it was bottom-24
      // while a tab bar stood there, and left behind it floated in open space.
      //
      // `md:hidden` is also what keeps the single showing from being spent at a
      // desk, where the bar's arrows and the arrow keys are the way through and
      // there is no swipe to explain: a hidden element has no box, so it never
      // comes into view and `useSwipeHint` never fires. Which matters most on
      // the machines that are both — a tablet in landscape spends nothing, and
      // has the mark waiting when it is turned.
      className="pointer-events-none fixed inset-x-0 bottom-12 z-30 flex justify-center md:hidden"
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
 * Every listener is passive and nothing here calls `preventDefault`: the gesture
 * is read after the movement rather than taken from it. That is what leaves a
 * long song's vertical scroll completely alone — the failure `touch-none` would
 * have caused, and one that a desktop, where a mouse has no such conflict, never
 * shows.
 *
 * Four of its guards live at the moment the finger goes down, which is where a
 * gesture is claimed or dropped: one finger only, clear of both screen edges, no
 * open sheet, and not starting on a control. Two more cannot be answered there —
 * a second finger arriving partway through, and a movement that changed what is
 * selected — so each is read where it happens.
 */
function useSwipePaging(position: ListPosition, surface: RefObject<HTMLElement | null>): void {
  const navigate = useNavigate();
  // The two strings rather than `position` itself, which is built during render
  // and so is a new object every time: held whole, the listeners below would be
  // torn down and rebuilt on every re-render the page has — a query settling,
  // the reader changing the text size. These and `navigate` are also the whole
  // of what either one reads.
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

      // An open sheet owns the gestures over it, as it owns the arrow keys, and
      // for the same reason: paging the song out from under one reads as a bug
      // in the sheet. Asked of the DOM rather than of this page, so the next
      // sheet is covered without anyone having to add it to a list.
      if (modalIsOpen()) return;

      // Belt and suspenders, and deliberately the safe way round: a swipe that
      // starts on a control does nothing, rather than a control being
      // unreachable under the gesture — the inversion of the tap strips this
      // replaced. Browsers already drop the click a moving touch would have
      // synthesized, so this rarely has anything to do.
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;

      from = {
        x: touch.clientX,
        y: touch.clientY,
        at: event.timeStamp,
        selected: selectedText(),
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

      // The movement changed what is selected: a long press and a drag
      // sideways, which ends exactly where a swipe ends and means the opposite
      // of leaving. Compared against how the gesture started rather than simply
      // read, so a selection made earlier and left on the page cannot quietly
      // kill every swipe after it — and so that dragging a handle to *extend* a
      // selection, which starts with one already there, is refused too. Asking
      // only whether anything is selected now would take the first and miss the
      // second.
      if (selectedText() !== start.selected) return;

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

      // Replaced, not pushed — the rule at the top of the file, which is what
      // leaves the back gesture as the way out of the list.
      navigate(href, { replace: true });
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

/** What is selected on the page, as text. Nothing selected is "". */
function selectedText(): string {
  return window.getSelection()?.toString() ?? "";
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
 * Answers null whenever there is nothing to draw, which is the caller's cue to
 * render nothing at all: on the very first render, before the stored answer is
 * in; on a device that has already had its showing; and again after the fade
 * has run. There is then nothing to observe and nothing to draw.
 *
 * Hands back the callback to attach to the mark rather than taking a ref, which
 * is what lets the observer be set up whenever the mark actually arrives. See the
 * state it is held in below.
 */
/**
 * Whether this device still has its one showing of the mark, and how it is
 * spent.
 *
 * Wrapped like `lib/fontSize`'s pair and `lib/theme`'s, and for the first of
 * the two reasons those give: a browser can refuse to hand its storage over,
 * and the access throws rather than answering. Bare, that took the whole song
 * page down and only for a reader who opened it from a list — the read runs in
 * a layout effect, where React has no boundary above it to catch anything, and
 * the write runs inside the observer's callback, where a throw would leave the
 * mark shown and never faded.
 *
 * Spent is what a refusal answers, because the two halves have to agree: a
 * device that cannot record the showing would otherwise be given it on every
 * song, forever.
 *
 * Inline rather than a fourth `stored*`/`store*` module, the key belonging to
 * this hook and nothing else reading it.
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
    // Nothing to record it in, and nothing to do about that: the read above
    // answers "spent" on this browser, so the mark is not offered again.
  }
}

function useSwipeHint(): [boolean | null, (element: HTMLElement | null) => void] {
  // The spent answer first, and the stored one a tick later. That is more than
  // the caution the reader's font size takes next door, because this read
  // really does decide markup: the caller renders nothing at all while this
  // hook answers null, so the observed box either exists or it does not. Read
  // during the first render, a server would say "no box" and the browser
  // "box", and React answers that disagreement by throwing the server's HTML
  // away and rendering the whole root again.
  //
  // Nothing is lost by starting spent. The mark waits for an
  // IntersectionObserver before it shows anything, so the commit it now arrives
  // a beat late for is one it was invisible in anyway; and the single showing
  // still cannot be spent at a desk, where `md:hidden` leaves the box no
  // geometry to intersect with. A layout effect rather than the ordinary one
  // that delay would also allow, so that this read and the font size next door
  // are one shape — and so the flip lands before the paint rather than after
  // it, which is the cheaper of the two orders here and the safer one to copy.
  //
  // Only the first render is the default: the read happens once, and the answer
  // cannot change under a mounted page since this hook is the only writer.
  const [unspent, setUnspent] = useState(false);
  useLayoutEffect(() => {
    setUnspent(hintUnspent());
  }, []);
  const [hinting, setHinting] = useState(false);
  const [over, setOver] = useState(false);
  // Held in state rather than a ref, because the effect below has to run when the
  // mark arrives — and it can arrive later than the first render, on a list that
  // gains a second song while it is open. A ref is the same object throughout, so
  // the effect would never run again: no observer would ever be made, and that
  // reader would have the showing neither spent nor delivered.
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
  // The two strings rather than `position` itself, for the reason
  // `useSwipePaging` gives above.
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

      // Claimed only once the key is actually being acted on, and every guard
      // above has returned instead. A left or right arrow still scrolls the
      // document sideways by default, so without this a song whose lyrics
      // overflow the column pages *and* scrolls on one press.
      event.preventDefault();
      // Replaced, not pushed — the rule at the top of the file, stated a third
      // time because this is the third place it can be dropped from.
      navigate(href, { replace: true });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, nextHref, previousHref]);
}
