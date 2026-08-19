import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ListMusic } from "lucide-react";

import { cardChrome, cardHover } from "./cardStyles";
import { cn } from "@/lib/cn";
import type { ListPosition, ListStep } from "@/lib/listContext";

/*
 * Moving through a list without leaving it.
 *
 * Three affordances for one movement, because they are reached in different
 * ways: the bar is there before the song is read, the strips are under the thumb
 * while it is being read on a phone, and the footer is what the end of long
 * lyrics arrives at. Each is a <Link> rather than a button — the destination is
 * a URL, so opening a neighbor in a new tab, and everything else a browser does
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
const HINT_SEEN_KEY = "lyrics:tap-hint-seen";

/**
 * The left and right edges of the lyrics, as previous and next.
 *
 * A story's gesture, kept inside the one part of a song page that has nothing to
 * press. These strips used to be fixed to the viewport and cover the whole of
 * it, with every control on the page lifted above them one region at a time —
 * an allowlist, and so a thing that had to be right in two places at once. Two
 * failures came of that, both of them only on a phone. A near miss became a
 * navigation: the gap between two buttons, or the few pixels under Back, paged
 * the song instead of doing nothing. And a strip could take a slightly-off tap
 * on a small control outright, because touch adjustment weighs every clickable
 * candidate under the contact patch rather than the one point beneath its
 * center — which is why it went wrong on a phone and never under a mouse.
 *
 * Scoped to the lyrics, nothing needs lifting and no allowlist has to be kept:
 * the strips only ever lie over text. The cost is that a song with no lyrics has
 * no strips, and a short one has a short pair — the bar above and the footer
 * below are still there, and both say where they go, which is more than a strip
 * ever did.
 *
 * Deliberately *without* `touch-none`, which the drag handle next door needs and
 * this must not have: it would hand this element's gestures to the drag
 * library's side of the fence, and a strip down each edge of the lyrics that
 * cannot be scrolled through makes a long song unreadable. A tap arrives as a
 * click without it.
 *
 * Nothing is rendered at the ends of a list, so an edge tap there falls through
 * to the lyrics rather than pressing a dead control.
 */
export function ListSongTapStrips({ position }: { position: ListPosition }) {
  const strips = useRef<HTMLDivElement>(null);
  const hinting = useTapHint(strips);

  // A list of one has nothing either side, and the same early return the footer
  // makes. Without it this renders an empty box and starts an observer that can
  // only spend the mark's one showing on a page with no strips to show it on.
  if (!position.previous && !position.next) return null;

  return (
    <div
      ref={strips}
      // Reaching a page's worth of padding past the column on each side, so a
      // strip ends at the edge of a phone screen rather than at the edge of the
      // text.
      //
      // `pointer-events-none` here and `pointer-events-auto` on the strips: this
      // box spans the full width of the lyrics, and left to take pointers it
      // would swallow every tap and drag on the text — no selecting a line, no
      // following a link a future lyrics view might put in one.
      //
      // `md:hidden` is also what keeps `useTapHint` from spending its one
      // showing at a desk: a hidden element has no box, so it never comes into
      // view and the hint below never fires.
      className="pointer-events-none absolute -inset-x-4 inset-y-0 md:hidden"
    >
      <TapStrip step={position.previous} back hinting={hinting} />
      <TapStrip step={position.next} hinting={hinting} />
    </div>
  );
}

function TapStrip({
  step,
  back,
  hinting,
}: {
  step?: ListStep;
  back?: boolean;
  hinting: boolean;
}) {
  if (!step) return null;

  const Icon = back ? ChevronLeft : ChevronRight;

  return (
    <Link
      to={step.href}
      // Named by where it goes rather than by which way it goes: a strip carries
      // no visible label of its own, and the title is what a reader wants to
      // know before pressing it.
      aria-label={`${back ? "Previous" : "Next"}: ${step.title}`}
      className={cn(
        "pointer-events-auto absolute inset-y-0 flex w-12 select-none items-end justify-center",
        "active:bg-stone-500/10 dark:active:bg-white/10",
        back ? "left-0" : "right-0",
      )}
    >
      {/* The mark that says the strip is there, and the only thing that does.
          `sticky` puts it wherever in the lyrics the reader is when it plays,
          rather than at the end of a strip that may be a screen and a half
          long; `bottom-24` rests it in thumb reach and clear of the tab bar,
          the same allowance the page itself makes for it.

          It carries its own backing because it floats over the lyrics, and a
          translucent gray on gray is a gesture nobody can see — which is a
          gesture nobody finds. Opaque enough not to need a backdrop filter,
          which would cost a blur pass per scrolled frame for 28px of
          decoration. */}
      <span
        aria-hidden
        className={cn(
          "sticky bottom-24 flex size-7 items-center justify-center rounded-full bg-stone-50/90 text-stone-500 shadow-sm transition-opacity duration-700 dark:bg-stone-900/90 dark:text-stone-400",
          hinting ? "opacity-100" : "opacity-0",
        )}
      >
        <Icon className="size-5" />
      </span>
    </Link>
  );
}

/**
 * Shows the mark once, the first time the strips are really on screen.
 *
 * A strip has no label and no chrome of its own, so something has to say that it
 * is there. Shown on arrival at every song it would be a flash on every step,
 * which is a decoration arguing with the reading surface it sits on; shown never,
 * the gesture is found by accident or not at all. Once per device, then the
 * lyrics are clean.
 *
 * It waits for the strips to come into view rather than for the page to mount,
 * because the lyrics of a song with a video start below the fold: spent on
 * arrival, the one showing there will ever be would play where nobody could see
 * it. `rootMargin` holds it back a little further still — the mark rests about
 * 124px up from the bottom of the viewport, so a sliver of strip peeking over
 * that edge is not yet anywhere it can be read.
 *
 * Recorded when it is shown rather than when it finishes, so a reader who steps
 * on mid-fade is not shown it again on the next song.
 */
function useTapHint(strips: RefObject<HTMLElement | null>): boolean {
  const [hinting, setHinting] = useState(false);

  useEffect(() => {
    const element = strips.current;
    if (!element) return;
    if (localStorage.getItem(HINT_SEEN_KEY) !== null) return;

    let fade: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        observer.disconnect();
        localStorage.setItem(HINT_SEEN_KEY, "1");
        setHinting(true);
        fade = setTimeout(() => setHinting(false), HINT_VISIBLE_MS);
      },
      { rootMargin: "0px 0px -140px 0px" },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      clearTimeout(fade);
    };
  }, [strips]);

  return hinting;
}

/**
 * The songs on either side, named, where long lyrics end.
 *
 * The bar has scrolled away by the time a reader reaches here, and a phone's tap
 * strips say nothing about what they lead to. This is the one place with the room
 * to name both.
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
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

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
