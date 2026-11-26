"use client";

import { ChevronUp, ListMusic, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useSong } from "@/api/hooks";
import { useListPosition } from "@/api/useListPosition";
import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { CATALOG_SEARCH_ATTRIBUTE } from "@/components/SearchField";
import { currentEntry, type NavItem, offeredEntries, useWarmLists } from "@/components/navItems";
import { SongSearchBox } from "@/components/SongSearch";
import { Sheet } from "@/components/ui";
import { cn } from "@/lib/cn";
import { positionLabel } from "@/lib/listContext";
import { NavLink, useNavigationKey, usePathname, useSearchParams } from "@/lib/navigation";
import type { User } from "@/lib/types";
import { revealChrome, scrollToTop, useChromeScroll } from "@/lib/scrollChrome";

/**
 * A phone's navigation and search, floating above the bottom edge: below `md`
 * only, where the column is not in the layout. The tabs are the column's
 * entries less Admin, which a phone reaches from Profile (`offeredEntries`),
 * lit by the same rule (`currentEntry`).
 *
 * While the reader scrolls down it shrinks to a small pill saying where they
 * are, and it comes back on a scroll up, at the top of the page, on a tap on
 * the pill, and when focus moves into it (`lib/scrollChrome`). It shrinks and
 * grows with the scroll itself, pixel for pixel, as Safari's toolbar does, and
 * once the scroll comes to rest it finishes the way the reader went. The bar's own
 * surface shrinks into the pill, rather than one fading out as the other fades
 * in, so the eye follows it down and sees where the tabs went; only at the
 * pill's size does the face's own surface take over from it. Collapsed is
 * only how it looks: the tabs stay in the accessibility tree and in the tab
 * order, and reaching one brings the bar back. Styles are `.bottom-bar` in
 * index.css, drawn from `--chrome-scroll-progress` on the bar and `data-chrome-tucked`
 * on <html>, so a tuck re-renders nothing here.
 */
export function BottomBar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const current = currentEntry(pathname, useSearchParams(), user, { phone: true });
  const navigationKey = useNavigationKey();
  const [searching, setSearching] = useState(false);
  const { navRef, faceRef } = usePillScale();
  const barRef = useRef<HTMLDivElement>(null);
  useChromeScroll(barRef);

  // Any navigation closes the search, before the new screen is drawn: a result
  // chosen, Enter, or "See all". Keyed on the navigation, not the pathname, so
  // the song already open, chosen again, closes it too.
  const [searchedAt, setSearchedAt] = useState(navigationKey);
  if (searchedAt !== navigationKey) {
    setSearchedAt(navigationKey);
    setSearching(false);
  }

  const tabs = offeredEntries(user, { phone: true });

  // Browse is the search: its own field, with the filters beside it and every
  // match below it. A sheet over it would be a second, smaller copy, so the
  // button goes to the field instead, bringing the header back if it was away.
  const search = () => {
    const field =
      pathname === "/"
        ? document.querySelector<HTMLInputElement>(`[${CATALOG_SEARCH_ATTRIBUTE}]`)
        : null;
    if (!field) {
      setSearching(true);
      return;
    }
    revealChrome();
    field.focus();
  };

  return (
    <>
      <div
        ref={barRef}
        // Presses through its own margins land on the page; the tabs and the
        // pill take theirs back (index.css).
        className="bottom-bar chrome-follows pointer-events-none fixed inset-x-0 bottom-0 z-sticky flex justify-center px-4 pb-(--bottom-bar-gap) md:hidden"
      >
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: tracks focus arriving in its links; nothing here is pressed. */}
        <nav
          ref={navRef}
          aria-label="Navigation"
          // Focus arriving by Tab, or a screen reader's cursor, opens the bar,
          // so what has focus is never drawn shrunk. index.css holds it open
          // while visible focus stays inside, and puts it away while a field
          // elsewhere has the keyboard up.
          onFocus={revealChrome}
          // Round, but by index.css, which rounds the shrunk pill too. No
          // backdrop blur: through a 95% surface it was all but invisible,
          // and it was recomputed on every frame of the shrink.
          className={cn("bottom-bar-tabs flex w-full max-w-md p-1 shadow-popover", barSurface)}
        >
          {/* One box to fade, apart from the surface, which stays. The tabs'
              own `transition` would outrank a fade set on each. */}
          <div className="bottom-bar-row relative flex min-w-0 flex-1 items-stretch gap-1">
            {/* Every tab, and Search after them. Drawn afresh when the tabs
                change (the reader's account arriving after the server's
                guest bar, or a sign-in or out), so it is not seen sliding
                across tabs that moved under it. */}
            <LitTabMark
              key={tabs.length}
              index={current ? tabs.indexOf(current) : -1}
              count={tabs.length + 1}
            />
            {tabs.map((item) => (
              <BarTab key={item.to} item={item} user={user} active={item === current} />
            ))}
            <button type="button" onClick={search} className={cn(tabChrome, idleTab)}>
              <Search aria-hidden className="size-5" />
              Search
            </button>
          </div>
        </nav>

        {/* What the shrunk bar shows. A duplicate of the tabs for a screen
            reader, which reaches those instead, so hidden from it and out of
            the tab order; a tap on it brings the tabs back.

            The tabs' own surface shrinks to the face's size, and the face's
            own surface takes over from it there (index.css). The face is
            24px, too small for a thumb, so the button around it is a full
            44px, reaching 8px down into the gap under the bar and 12px up
            over the page. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={revealChrome}
          className="bottom-bar-pill absolute inset-x-0 bottom-[calc(var(--bottom-bar-gap)-(--spacing(2)))] mx-auto flex h-11 w-fit max-w-[75%] px-2 pt-3 pb-2"
        >
          <span
            ref={faceRef}
            className={cn(
              "bottom-bar-pill-face flex h-6 min-w-0 items-center gap-1 rounded-full px-2.5 text-xs leading-none font-medium text-fg-secondary shadow-raised",
              barSurface,
            )}
          >
            <Whereabouts entry={current} />
            {/* Says the pill opens, as Safari's shrunk address bar does. */}
            <ChevronUp aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
          </span>
        </button>
      </div>

      {/* Outside the bar, which is `display: none` from `md` up: a sheet left
          open across the breakpoint would otherwise stay modal, unseen. */}
      <Sheet open={searching} onClose={() => setSearching(false)} title="Search" fullScreen>
        <SongSearchBox variant="sheet" autoFocus onEscape={() => setSearching(false)} />
      </Sheet>
    </>
  );
}

/**
 * Measures how far the tabs' surface shrinks to become the pill: the face's
 * width and height over the surface's, as `--pill-sx` and `--pill-sy` on the
 * surface itself, which index.css scales it by, and the surface's height as
 * `--bar-height`, which keeps its ends round at every size in between.
 * Remeasured whenever either changes size: the song's title arriving, a phone
 * turned. Written straight to the style, since nothing React draws depends on
 * it.
 */
function usePillScale() {
  const navRef = useRef<HTMLElement>(null);
  const faceRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const face = faceRef.current;
    if (!nav || !face) return;
    const measure = () => {
      // Layout sizes, which the surface's own scale leaves alone. Zero is a
      // bar not laid out (from `md` up), where the scale is moot.
      if (!nav.offsetWidth || !nav.offsetHeight) return;
      nav.style.setProperty("--pill-sx", String(face.offsetWidth / nav.offsetWidth));
      nav.style.setProperty("--pill-sy", String(face.offsetHeight / nav.offsetHeight));
      nav.style.setProperty("--bar-height", `${nav.offsetHeight}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    observer.observe(face);
    return () => observer.disconnect();
  }, []);
  return { navRef, faceRef };
}

/**
 * The bar's surface, which the pill's face draws too: index.css fades one into
 * the other, so they must match. Each has its own shadow, sized to it.
 */
const barSurface = "border border-line bg-surface/95";

/**
 * A tab that is not lit, and Search: muted, shaded on a hover, and on a press
 * shaded and giving a little, so a tap answers before the next screen does;
 * hover alone never fires on a touch. Not the lit tab, which a press leads
 * nowhere and whose shading, `LitTabMark`, would stay full size around it.
 */
const idleTab = "text-fg-tertiary hover:bg-subtle active:bg-subtle motion-safe:active:scale-95";

/**
 * A tab's box: a column of icon and label, a thumb's width. Every tab is
 * `flex-1`, so all are one width, which `LitTabMark` relies on. `relative`
 * lifts it over the mark. `transition` rather than `transition-colors`, so a
 * press's scale (`idleTab`) eases too.
 */
const tabChrome =
  "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[11px] leading-tight font-medium transition";

/**
 * The lit tab's shading, one mark for the whole row, so a new lit tab is the
 * mark sliding across to it rather than one fading out and another in. Placed
 * from the lit tab's index among `count` equal tabs (`tabChrome`), not
 * measured: the server draws it where it belongs, and a first paint never
 * slides it from somewhere else. Gone where no tab is lit (`index` -1): it
 * fades where it last stood, rather than sliding to the first tab as it goes.
 */
function LitTabMark({ index, count }: { index: number; count: number }) {
  const [at, setAt] = useState(Math.max(index, 0));
  if (index >= 0 && index !== at) setAt(index);
  const gap = "var(--spacing)";
  return (
    <span
      aria-hidden
      className={cn(
        "bottom-bar-mark absolute inset-y-0 left-0 rounded-full bg-accent-subtle",
        "motion-safe:transition-[translate,opacity] motion-safe:duration-(--duration-chrome) motion-safe:ease-chrome",
        index < 0 && "opacity-0",
      )}
      style={{
        // `gap-1` between the tabs; a translate's 100% is the mark's own width.
        width: `calc((100% - ${count - 1} * ${gap}) / ${count})`,
        translate: `calc(${at} * (100% + ${gap}))`,
      }}
    />
  );
}

/** One of the bar's tabs. A signed-in reader's Profile is their picture. */
function BarTab({ item, user, active }: { item: NavItem; user: User | null; active: boolean }) {
  // Only the Lists tab carries the handlers, and only a signed-in reader has it.
  const intent = useWarmLists();
  const Icon = item.barIcon ?? item.icon;

  return (
    <NavLink
      href={item.to}
      active={active}
      // A tab leading to the screen already showing goes back to its top
      // instead, as a phone's own apps do. Only that exact screen: Lists lit on
      // a list, or Browse lit on a song or with filters set, still leads back
      // to its own.
      onShowing={scrollToTop}
      {...(item.warmsLists ? intent : undefined)}
      className={({ isActive }) =>
        cn(
          tabChrome,
          // The lit tab's shading is `LitTabMark`, under it.
          isActive ? "text-fg-accent-subtle" : idleTab,
        )
      }
    >
      {item.identityCard && user ? (
        // `size-5` with the icons: the tabs keep one height.
        <Avatar user={user} className="size-5 text-[8px]" />
      ) : (
        <Icon aria-hidden className="size-5" />
      )}
      <span className="max-w-full truncate">{item.label}</span>
    </NavLink>
  );
}

/**
 * Where the reader is, for the shrunk bar: the list and the place in it on a
 * song read from one ("Ρεμπέτικα · 3 of 20"), the song's title on any other,
 * the list's name on its page, and elsewhere `entry`, the tab the bar lights.
 * The song and the list are the page's own queries, so this asks for nothing
 * the page has not.
 */
function Whereabouts({ entry }: { entry: NavItem | undefined }) {
  const { ref, list, position } = useListPosition();
  const { data: song } = useSong(ref, { fromCachedCard: true });

  if (position) {
    return (
      <>
        <ListMusic aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{position.listName}</span>
        <span className="shrink-0 tabular-nums text-fg-tertiary">· {positionLabel(position)}</span>
      </>
    );
  }
  // A list's own page.
  if (list && !ref) {
    return (
      <>
        <ListMusic aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{list.name}</span>
      </>
    );
  }
  if (ref) {
    return song ? (
      <span className="truncate" lang={song.language}>
        {song.title}
      </span>
    ) : (
      <span className="truncate">Song</span>
    );
  }
  // Undefined only for a song read from a list, which returned above.
  return <span className="truncate">{entry?.label}</span>;
}
