"use client";

import { LibraryBig, ListMusic, Search } from "lucide-react";
import { useState } from "react";

import { useList, useSong } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { CATALOG_SEARCH_ATTRIBUTE } from "@/components/SearchField";
import { NAV_ITEMS, type NavItem, offeredTo, useWarmLists } from "@/components/navItems";
import { SongSearchBox } from "@/components/SongSearch";
import { Sheet } from "@/components/ui";
import { cn } from "@/lib/cn";
import { listInView, listPosition, songRefFromPath, songSection } from "@/lib/listContext";
import {
  NavLink,
  pathMatches,
  useNavigationKey,
  usePathname,
  useSearchParams,
} from "@/lib/navigation";
import { revealChrome, useChromeTucked } from "@/lib/scrollChrome";

/** The bar's icon for an entry, where the column's would clash with Search. */
const BAR_ICONS: Partial<Record<string, typeof Search>> = {
  // The column's Browse is a magnifier, which beside the Search button would
  // be two of the same mark for two different things.
  "/": LibraryBig,
};

/**
 * A phone's navigation and search, floating above the bottom edge: below `md`
 * only, where the column is not in the layout. The tabs are the column's
 * entries (`NAV_ITEMS`), lit by the same rules, less Admin, which a phone
 * reaches from Profile.
 *
 * While the reader scrolls down it shrinks to a small pill saying where they
 * are, and it comes back on any scroll up, at the top of the page, on a tap on
 * the pill, and when focus moves into it (`lib/scrollChrome`). Collapsed is
 * only how it looks: the tabs stay in the accessibility tree and in the tab
 * order, and reaching one brings the bar back. Styles are `.bottom-bar` in
 * index.css.
 */
export function BottomBar() {
  const { user } = useAuth();
  const pathname = usePathname();
  const section = songSection(pathname, useSearchParams());
  const tucked = useChromeTucked();
  const navigationKey = useNavigationKey();
  const [searching, setSearching] = useState(false);

  // Any navigation closes the search, before the new screen is drawn: a result
  // chosen, Enter, or "See all". Keyed on the navigation, not the pathname, so
  // the song already open, chosen again, closes it too.
  const [searchedAt, setSearchedAt] = useState(navigationKey);
  if (searchedAt !== navigationKey) {
    setSearchedAt(navigationKey);
    setSearching(false);
  }

  const tabs = NAV_ITEMS.filter((item) => offeredTo(item, user) && !item.adminOnly);

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
        // Presses through its own margins land on the page; the tabs and the
        // pill take theirs back (index.css).
        className="bottom-bar pointer-events-none fixed inset-x-0 bottom-0 z-sticky flex justify-center px-4 pb-[max(--spacing(2),env(safe-area-inset-bottom))] md:hidden"
        data-tucked={tucked || undefined}
      >
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: tracks focus arriving in its links; nothing here is pressed. */}
        <nav
          aria-label="Navigation"
          // Focus arriving by Tab, or a screen reader's cursor, opens the bar,
          // so what has focus is never drawn shrunk. index.css holds it open
          // while focus stays inside.
          onFocus={revealChrome}
          className="bottom-bar-tabs flex w-full max-w-md items-stretch gap-1 rounded-full border border-line bg-surface/95 p-1 shadow-popover backdrop-blur"
        >
          {tabs.map((item) => (
            <BarTab key={item.to} item={item} section={section} />
          ))}
          <button
            type="button"
            onClick={search}
            className={cn(tabChrome, "text-fg-tertiary hover:bg-subtle")}
          >
            <Search aria-hidden className="size-5" />
            Search
          </button>
        </nav>

        {/* What the shrunk bar shows. A duplicate of the tabs for a screen
            reader, which reaches those instead, so hidden from it and out of
            the tab order; a tap on it brings the tabs back. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={revealChrome}
          className="bottom-bar-pill absolute inset-x-0 bottom-[max(--spacing(2),env(safe-area-inset-bottom))] mx-auto flex h-9 w-fit max-w-[75%] items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3.5 text-xs font-medium text-fg-secondary shadow-popover backdrop-blur"
        >
          <Whereabouts />
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

/** A tab's box: a column of icon and label, a thumb's width. */
const tabChrome =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[11px] leading-tight font-medium transition-colors";

/**
 * One of the bar's tabs. Lit as the column's link is, through `songSection`
 * on a song; Profile is lit across the admin console too, which a phone
 * reaches from it. A signed-in reader's Profile is their picture.
 */
function BarTab({ item, section }: { item: NavItem; section: string | undefined }) {
  const { user } = useAuth();
  const pathname = usePathname();
  // Only the Lists tab carries the handlers, and only a signed-in reader has it.
  const intent = useWarmLists();

  const active = item.identityCard
    ? pathMatches(pathname, item.to) || pathMatches(pathname, "/admin")
    : section === undefined
      ? undefined
      : section === item.to;
  const Icon = BAR_ICONS[item.to] ?? item.icon;

  return (
    <NavLink
      href={item.to}
      active={active}
      {...(item.warmsLists ? intent : undefined)}
      className={({ isActive }) =>
        cn(
          tabChrome,
          isActive ? "bg-accent-subtle text-fg-accent-subtle" : "text-fg-tertiary hover:bg-subtle",
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
 * the list's name on its page, and elsewhere the entry whose screen it is. The song and the list are the page's
 * own queries, so this asks for nothing the page has not.
 */
function Whereabouts() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = songRefFromPath(pathname) ?? undefined;
  const { data: song } = useSong(ref, { fromCachedCard: true });
  const { data: list } = useList(listInView(pathname, params) ?? undefined, !loading);

  const position = list && ref ? listPosition(list, ref) : null;
  if (position) {
    return (
      <>
        <ListMusic aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{position.listName}</span>
        <span className="shrink-0 tabular-nums text-fg-tertiary">
          · {position.index + 1} of {position.total}
        </span>
      </>
    );
  }
  // A list's own page.
  if (list && !ref) {
    return (
      <>
        <ListMusic aria-hidden className="size-4 shrink-0" />
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

  const here =
    NAV_ITEMS.find((item) => offeredTo(item, user) && pathMatches(pathname, item.to)) ??
    NAV_ITEMS[0];
  return <span className="truncate">{here?.label}</span>;
}
