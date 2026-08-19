import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ListMusic } from "lucide-react";

import { cardChrome, cardHover } from "./cardStyles";
import { aboveTapZones, tapZoneLayer } from "./tapZoneStyles";
import { cn } from "@/lib/cn";
import type { ListPosition, ListStep } from "@/lib/listContext";

/*
 * Moving through a list without leaving it.
 *
 * Three affordances for one movement, because they are reached in different
 * ways: the bar is there before the song is read, the zones are under the thumb
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
        aboveTapZones,
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

/**
 * The left and right edges of a phone screen, as previous and next.
 *
 * A story's gesture: the page is read with a thumb near the edge of the screen,
 * and that is where the next song is. Fixed to the viewport rather than placed in
 * the page, so a zone stays under the thumb however far down the lyrics the
 * reader has scrolled — which is what `aboveTapZones` on the page's own controls
 * is for, and the reason there is nothing here that keeps clear of them.
 *
 * Deliberately *without* `touch-none`, which the drag handle next door needs and
 * this must not have: it would hand this element's gestures to the drag library's
 * side of the fence, and a strip down each edge of the screen that cannot be
 * scrolled through makes a long song unreadable. A tap arrives as a click
 * without it.
 *
 * Nothing is rendered at the ends of a list, so an edge tap there falls through
 * to the page rather than pressing a dead control.
 */
export function ListSongTapZones({ position }: { position: ListPosition }) {
  return (
    <>
      <TapZone step={position.previous} back />
      <TapZone step={position.next} />
    </>
  );
}

function TapZone({ step, back }: { step?: ListStep; back?: boolean }) {
  if (!step) return null;

  const Icon = back ? ChevronLeft : ChevronRight;

  return (
    <Link
      to={step.href}
      // Named by where it goes rather than by which way it goes: a zone carries
      // no visible label of its own, and the title is what a reader wants to
      // know before pressing it.
      aria-label={`${back ? "Previous" : "Next"}: ${step.title}`}
      className={cn(
        // The strip is the full height of the screen; its mark sits low in it,
        // where a thumb rests and clear of the video — which paints above the
        // zone by design, and would hide a mark placed at the middle of the
        // screen on every song that has one. pb-24 clears the tab bar, the same
        // allowance the page itself makes for it.
        tapZoneLayer,
        "fixed inset-y-0 flex w-12 select-none items-end justify-center pb-24",
        "active:bg-stone-500/10 md:hidden dark:active:bg-white/10",
        back ? "left-0" : "right-0",
      )}
    >
      {/* The chevron carries its own backing: it floats over whatever the song
          puts behind it, and a translucent gray on gray is a gesture nobody can
          see — which is a gesture nobody finds. Opaque enough not to need a
          backdrop filter, which would cost a blur pass per scrolled frame for
          28px of decoration. */}
      <span className="flex size-7 items-center justify-center rounded-full bg-stone-50/90 text-stone-500 shadow-sm dark:bg-stone-900/90 dark:text-stone-400">
        <Icon aria-hidden className="size-5" />
      </span>
    </Link>
  );
}

/**
 * The songs on either side, named, where long lyrics end.
 *
 * The bar has scrolled away by the time a reader reaches here, and a phone's tap
 * zones say nothing about what they lead to. This is the one place with the room
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
      className={cn(
        aboveTapZones,
        "mt-10 grid gap-2 border-t border-stone-200 pt-5 sm:grid-cols-2 dark:border-stone-800",
      )}
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
  // a new object every time, and the listener would be torn down and rebuilt on
  // every keystroke it did not handle.
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
