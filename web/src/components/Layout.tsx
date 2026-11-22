"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ListMusic, Menu, PanelLeftClose, Search, Shield, User as UserIcon } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { listsQuery } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { buttonClasses } from "@/components/buttonStyles";
import { Button } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";
import { FIELDS, useHomeEndInside } from "@/lib/modal";
import { applyNavCollapsed, storeNavCollapsed, storedNavCollapsed } from "@/lib/navCollapsed";
import { Link, NavLink, useNavigationKey, usePathname } from "@/lib/navigation";
import { NAV_DRAWER_ID, NavDrawerContext, useNavDrawer } from "@/lib/navDrawer";
import { hasRole } from "@/lib/types";
import { useIntentPrefetch } from "@/lib/useIntentPrefetch";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Search;
  /** Only shown when signed in. */
  authOnly?: boolean;
  adminOnly?: boolean;
  /**
   * Replaced by the identity card while signed in. A guest keeps the link:
   * `/profile` is the only home of the theme switch.
   */
  identityCard?: boolean;
  /** Loads the reader's lists on intent, so the screen opens with them. */
  warmsLists?: boolean;
}

/**
 * The lit and pressable treatments shared by the nav links and the identity
 * card. Only the lit one carries a text color: at rest the card inherits.
 */
const SIDEBAR_ACTIVE = "bg-accent-subtle text-fg-accent-subtle";
const SIDEBAR_HOVER = "hover:bg-subtle";

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Browse", icon: Search },
  { to: "/lists", label: "Lists", icon: ListMusic, authOnly: true, warmsLists: true },
  { to: "/profile", label: "Profile", icon: UserIcon, identityCard: true },
  // The section, not a screen: NavLink matches on prefix, so it stays lit
  // across the console's screens.
  { to: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

/** The column's id, so opening it can move focus onto its first link. */
const NAV_SIDEBAR_ID = "nav-sidebar";

/** Tailwind's `md`. The column is part of the layout from here up; below it, the drawer is. */
const NAV_COLUMN_QUERY = "(min-width: 768px)";

/**
 * Focuses the first element `selector` matches that has a box, or the first
 * match when nothing does — jsdom lays nothing out, and a control that is
 * `display: none` has no box in a browser either.
 */
function focusFirst(selector: string) {
  const nodes = [...document.querySelectorAll<HTMLElement>(selector)];
  const visible = nodes.find((node) => node.getClientRects().length > 0);
  (visible ?? nodes[0])?.focus({ preventScroll: true });
}

/** Puts the column away and moves focus to the button that brings it back. */
function hideNavigation() {
  applyNavCollapsed(true);
  storeNavCollapsed(true);
  focusFirst(".nav-menu-button");
}

/**
 * Brings the navigation back. From `md` up that is the column; below it the
 * column is not in the layout, and the drawer is what opens.
 */
function showNavigation(openDrawer: () => void) {
  if (window.matchMedia(NAV_COLUMN_QUERY).matches) {
    applyNavCollapsed(false);
    storeNavCollapsed(false);
    focusFirst(`#${NAV_SIDEBAR_ID} a`);
    return;
  }
  openDrawer();
}

/**
 * App shell: a navigation column from `md` up, which the reader can collapse,
 * and the same navigation behind a hamburger on a phone — and on a desk, once
 * the column is collapsed.
 */
export function Layout({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const navigationKey = useNavigationKey();
  const [navOpen, setNavOpen] = useState(false);

  // Route changes start at the top. Keyed on `pathname` so a filter written
  // into the query string does not scroll the catalog.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger, not a value read.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  // Any navigation closes the drawer, before the new screen is drawn. Keyed on
  // the navigation, not the pathname, so a link to the current screen closes it
  // too.
  const [navKey, setNavKey] = useState(navigationKey);
  if (navKey !== navigationKey) {
    setNavKey(navigationKey);
    setNavOpen(false);
  }

  // The boot script paints the stored choice. A tree mounted without that
  // script — a story, a spec — applies it here, before paint.
  useLayoutEffect(() => {
    applyNavCollapsed(storedNavCollapsed());
  }, []);

  // Growing past `md` (768px) closes the drawer. The button that opened it is
  // hidden while the column is on screen, so an open drawer would keep the
  // page inert, and the song page's swipe and arrow keys standing down, with
  // the only control that opened it gone.
  useEffect(() => {
    const desk = window.matchMedia(NAV_COLUMN_QUERY);
    const close = (event: MediaQueryListEvent) => {
      if (event.matches) setNavOpen(false);
    };

    desk.addEventListener("change", close);
    return () => desk.removeEventListener("change", close);
  }, []);

  // Memoized so consumers re-render only when the drawer opens or closes.
  const drawer = useMemo(() => ({ open: navOpen, setOpen: setNavOpen }), [navOpen]);

  return (
    <NavDrawerContext.Provider value={drawer}>
      <div className="min-h-dvh md:flex">
        <DesktopSidebar />
        <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />

        {/* `app` is the content column. The list and the lyrics become two
            panes once it is wide enough, which collapsing the navigation is
            what makes true on a narrower window. Extra bottom room clears the
            home indicator; index.css takes it off once the panes are up, or
            the window would scroll past them. */}
        <main className="@container/app min-w-0 flex-1">
          {/* No Suspense boundary here: a server streams the shell the moment
              one sits above a page, so a page's `notFound()` or redirect
              arrives as a 200 with a meta tag rather than a 404 or a 308. */}
          <div className="app-column pb-12 md:pb-8">{children}</div>
        </main>
      </div>
    </NavDrawerContext.Provider>
  );
}

/**
 * One of the navigation's links. The Lists link starts loading the lists on
 * hover, press or focus, which otherwise wait for the click and show
 * placeholders until they land.
 */
function NavEntry({ item }: { item: NavItem }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const signedIn = Boolean(user);
  const prefetch = useCallback(() => {
    if (item.warmsLists && signedIn) void queryClient.prefetchQuery(listsQuery());
  }, [queryClient, item.warmsLists, signedIn]);
  const intent = useIntentPrefetch(prefetch);

  return (
    <NavLink
      href={item.to}
      data-guest-only={item.identityCard || undefined}
      {...(item.warmsLists ? { ...intent, onFocus: prefetch } : undefined)}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors",
          isActive ? SIDEBAR_ACTIVE : cn(SIDEBAR_HOVER, "text-fg-tertiary"),
        )
      }
    >
      <item.icon aria-hidden className="size-5" />
      {item.label}
    </NavLink>
  );
}

/**
 * The navigation itself: the wordmark, the links, and the identity card or the
 * Sign in button at its foot.
 *
 * Shared by the sidebar and the drawer. Every visibility rule is answered here,
 * not at either call site.
 */
function NavPanel({ wordmarkTrailing }: { wordmarkTrailing?: ReactNode }) {
  const { user } = useAuth();

  const links = NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return hasRole(user?.role, "admin");
    if (item.authOnly) return Boolean(user);
    // Only a guest, who has no card, keeps the link.
    if (item.identityCard) return !user;
    return true;
  });

  return (
    <>
      <div
        className={cn(
          "mb-8 flex items-center gap-1 px-2",
          // The desktop row is as tall as the search field and a song's tools,
          // so the collapse control shares their center. The link is a flex
          // item: an inline one keeps a line box under the wordmark and the
          // control then sits below it.
          wordmarkTrailing ? "min-h-12" : undefined,
        )}
      >
        <Link href="/" className="flex min-w-0 items-center">
          <Wordmark />
        </Link>
        {wordmarkTrailing}
      </div>

      {/* The card stays inside the <nav> landmark: it is the way to
          `/profile`. `flex-1` gives the `mt-auto` below room to reach the
          bottom. */}
      <nav className="flex flex-1 flex-col gap-1">
        {links.map((item) => (
          <NavEntry key={item.to} item={item} />
        ))}

        <div className="mt-auto px-2 pt-6">
          {user ? (
            // The profile entry, with the links' lit and hover treatments.
            // `-mx-2` lines its background up with the links above.
            <NavLink
              href="/profile"
              className={({ isActive }) =>
                cn(
                  "-mx-2 flex min-w-0 items-center gap-2.5 rounded-control px-2 py-2 transition-colors",
                  isActive ? SIDEBAR_ACTIVE : SIDEBAR_HOVER,
                )
              }
            >
              <Avatar user={user} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.display_name ?? user.email}</p>
                <p className="text-xs capitalize text-fg-tertiary">{user.role}</p>
              </div>
            </NavLink>
          ) : (
            <Link
              href="/login"
              data-guest-only
              className={cn(buttonClasses("primary", "md"), "w-full")}
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </>
  );
}

function DesktopSidebar() {
  return (
    <aside id={NAV_SIDEBAR_ID} className="nav-sidebar sticky top-0 h-dvh shrink-0">
      {/* The width lives on the column, which is what slides. This panel stays
          at that open width, so the links do not reflow as it clips away. */}
      <div
        // `pt-3` is the search header's padding. With the wordmark row at
        // `min-h-12`, the collapse control centers on that field and the tools.
        className="nav-sidebar-panel flex h-full shrink-0 flex-col border-r border-line bg-surface px-4 pt-3 pb-6"
      >
        <NavPanel
          wordmarkTrailing={
            // Into the row's padding, so the wordmark keeps the room it had
            // before the button sat beside it. Desktop only: the column is not
            // on screen below `md`.
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={hideNavigation}
              aria-label="Hide navigation"
              className="-mr-2 shrink-0"
            >
              <PanelLeftClose aria-hidden className="size-5" />
            </Button>
          }
        />
      </div>
    </aside>
  );
}

/** The drawer's vertical scrolling keys: which way, and by a line or a page. */
const VERTICAL_KEYS: Record<string, [direction: 1 | -1, page: boolean]> = {
  ArrowDown: [1, false],
  ArrowUp: [-1, false],
  PageDown: [1, true],
  PageUp: [-1, true],
  " ": [1, true],
};

/**
 * Scrolls the drawer to its closed stop. `auto` defers to the stylesheet:
 * smooth unless motion is reduced. Marks it leaving, so a slide in still
 * waiting on its frames stands down.
 *
 * A sheet that has not reached the screen yet is closed at once instead: the
 * observer only closes on the way *off* the screen, so a scroll that never
 * brought it on would leave an invisible modal over the page.
 */
function slideOutOf(
  track: HTMLDialogElement | null,
  leaving: RefObject<boolean>,
  shown: RefObject<boolean>,
) {
  if (!track?.open) return;
  leaving.current = true;
  if (shown.current) track.scrollTo({ left: track.offsetWidth, behavior: "auto" });
  else track.close();
}

/**
 * The same navigation on a phone: a modal `<dialog>`, so the browser makes the
 * page inert, moves focus in, closes on Escape and hands focus back.
 *
 * The dialog is also a horizontal scroller with two snap stops, the sheet and
 * a viewport-wide spacer, so the swipe that dismisses it is the browser's own
 * scrolling and follows the finger. Closing is a scroll to the spacer, and the
 * observer below calls `close()` once the sheet is off-screen: a closed dialog
 * is `display: none`, so closing first would cut the slide. Styles are
 * `.nav-drawer` in index.css. See "Frontend" in CLAUDE.md.
 */
function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  // Whether the sheet has been on screen since `showModal()`. Until it has,
  // being off-screen is where it starts, not a dismissal.
  const shown = useRef(false);
  const leaving = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  // WebKit would otherwise send Home and End to the page behind.
  useHomeEndInside(open, dialog);
  // And the other vertical keys too, from a link in the list: it scrolls the
  // page under the drawer rather than the list the link is in, since the
  // dialog itself scrolls only sideways. Taken here and given to the list.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = VERTICAL_KEYS[event.key];
      const target = list.current;
      if (!key || !target || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Space presses a button; a field keeps every key.
      const from = event.target instanceof Element ? event.target : null;
      if (from?.closest(FIELDS) || (event.key === " " && from?.closest("button"))) return;
      event.preventDefault();
      const [direction, page] = key;
      // Shift+Space is a page up.
      const sign = event.key === " " && event.shiftKey ? -direction : direction;
      target.scrollBy({ top: sign * (page ? target.clientHeight * 0.9 : 40) });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  const slideOut = () => slideOutOf(dialog.current, leaving, shown);

  // An open dialog is closed before it is unmounted, so `close()` can still
  // hand focus back. A layout cleanup, since that runs before React removes it.
  useLayoutEffect(() => {
    const element = dialog.current;
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  // Once: the observer that closes the dialog, and the dim's fallback.
  useEffect(() => {
    const element = dialog.current;
    const panel = sheet.current;
    if (!element || !panel) return;

    // Any pixel of the sheet still showing counts as open.
    const visible = 1 / window.innerWidth;
    const observer = new IntersectionObserver(
      (entries) => {
        // A programmatic scroll can deliver several; the last is where it is.
        const ratio = entries.at(-1)?.intersectionRatio ?? 0;
        if (ratio >= visible) shown.current = true;
        else if (shown.current && element.open) element.close();
      },
      { root: element, threshold: visible },
    );
    observer.observe(panel);

    // Without scroll-driven animations the stylesheet never writes the dim.
    const fade = () => {
      const progress = 1 - element.scrollLeft / (panel.offsetWidth || 1);
      element.style.setProperty("--drawer-backdrop", String(Math.max(0, progress)));
    };
    if (!CSS.supports("animation-timeline: scroll()")) {
      element.addEventListener("scroll", fade, { passive: true });
    }

    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", fade);
    };
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (!open) {
      // A navigation or the breakpoint rather than the drawer's own dismissal.
      slideOutOf(element, leaving, shown);
      return;
    }

    if (element.open) return;
    shown.current = false;
    leaving.current = false;
    element.showModal();
    // `showModal()` focuses the first focusable thing inside, and a link there
    // would scroll the sheet into view before it could slide. The dialog is
    // what a screen reader should land on anyway, being the thing named.
    // `close()` still hands focus to the opener `showModal()` recorded.
    element.focus({ preventScroll: true });

    // `scroll-initial-target` opens the scroller on the closed stop. Without
    // it, it opens on the sheet: jumped to the spacer first, and given two
    // frames to commit, since a scroll in the first would cancel the jump.
    if (CSS.supports("scroll-initial-target", "nearest")) {
      element.scrollTo({ left: 0, behavior: "auto" });
      return;
    }
    element.scrollTo({ left: element.offsetWidth, behavior: "instant" });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!leaving.current) element.scrollTo({ left: 0, behavior: "auto" });
      }),
    );
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is a tap on the dim; the keyboard's way out is Escape.
    <dialog
      ref={dialog}
      id={NAV_DRAWER_ID}
      aria-label="Navigation"
      // Focusable only as the target of `focus()` on opening.
      tabIndex={-1}
      className="nav-drawer outline-none"
      // Every close ends here: the observer's, and an uncancelable Escape's.
      onClose={onClose}
      // Escape slides out rather than vanishing. A repeated Escape with no
      // activation in between is uncancelable and closes at once.
      onCancel={(event) => {
        if (!event.cancelable) return;
        event.preventDefault();
        slideOut();
      }}
      // The dialog fills the viewport, so a tap on the dim lands on the dialog
      // rather than on `::backdrop`. That is also why this is not
      // `closedby="any"`, which would close without the slide.
      onClick={(event) => {
        if (!sheet.current?.contains(event.target as Node)) slideOut();
      }}
    >
      <div
        ref={sheet}
        className="nav-drawer-sheet flex flex-col border-r border-line bg-surface shadow-sheet pt-safe pb-safe"
      >
        {/* Padding here, not on the sheet, so it cannot collide with the
            safe-area padding. `min-h-0` lets this scroll, and it always does,
            by the extra pixel inside: iOS Safari honors `overscroll-behavior`
            only on a box that actually scrolls, and a vertical swipe here
            would otherwise scroll the page behind. `-y` only, so a sideways
            swipe still reaches the drawer. That pixel is real overflow, so
            the scrollbar it would paint is hidden on `.nav-drawer-list`. */}
        <div
          ref={list}
          className="nav-drawer-list min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-6"
        >
          <div className="flex min-h-[calc(100%+1px)] flex-col">
            <NavPanel />
          </div>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Opens the navigation. Rendered by the page's own header bar, since the shell
 * has no row of its own.
 *
 * On a phone it opens the drawer. From `md` up the column is the navigation, so
 * the button is hidden (index.css) until the reader collapses the column, and
 * then it opens the column again.
 */
export function MenuButton() {
  const { open, setOpen } = useNavDrawer();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => showNavigation(() => setOpen(true))}
      aria-label="Open menu"
      aria-expanded={open}
      aria-controls={NAV_DRAWER_ID}
      className="nav-menu-button shrink-0"
    >
      <Menu aria-hidden className="size-5" />
    </Button>
  );
}

/**
 * A sticky page header that gets out of the way on a phone.
 *
 * Hides on scroll down and returns on scroll up, below `md` only: the
 * `max-md:` prefix does that in CSS rather than tracking `matchMedia`, whose
 * answer would have to be kept in step with a window resized across the
 * breakpoint.
 *
 * `pinned` holds it still, for a header with something anchored to it.
 *
 * `mobileOnly` goes on the `<header>` itself, since a bordered box with a
 * hidden child still draws a hairline at a desk. Hidden from `md` up while the
 * column is open; when the column is collapsed the bar comes back, which is
 * the way to the navigation on a screen that has no search box.
 *
 * Its height is published as `--sticky-header-height` on `<html>`, which the
 * root's `scroll-padding-top` reads, so a control reached by Tab is scrolled
 * clear of the header rather than to the viewport edge underneath it. Measured
 * rather than written down: the catalog's filter chips change the height, and
 * a `mobileOnly` header at a desk is `display: none` and measures 0.
 */
export function StickyHeader({
  children,
  pinned,
  mobileOnly,
}: {
  children: React.ReactNode;
  pinned?: boolean | undefined;
  mobileOnly?: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const root = document.documentElement.style;
    // `offsetHeight` is the border box, so the safe-area padding counts too.
    // A header the layout has put away (`display: none`) measures 0. Publishing
    // that would clear the height of the header that is actually showing: the
    // list and the song each have one, and only one is on screen at a time.
    let published = "";
    const observer = new ResizeObserver(() => {
      const height = header.offsetHeight;
      if (height === 0) return;
      published = `${height}px`;
      root.setProperty("--sticky-header-height", published);
    });
    // Border box here too, or a rotation that changes only the inset is missed.
    observer.observe(header, { box: "border-box" });
    return () => {
      observer.disconnect();
      if (published !== "" && root.getPropertyValue("--sticky-header-height") === published) {
        root.removeProperty("--sticky-header-height");
      }
    };
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    // Only transitions are dispatched; scroll fires at frame rate.
    let current = false;

    const onScroll = () => {
      const y = window.scrollY;
      // Threshold against momentum-scroll jitter.
      if (Math.abs(y - lastY) > 8) {
        const next = y > lastY && y > 80;
        if (next !== current) {
          current = next;
          setHidden(next);
        }
        lastY = y;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      ref={ref}
      // Read by index.css, which keeps focus inside the header from scrolling.
      data-sticky-header
      className={cn(
        "sticky top-0 z-sticky border-b border-line bg-canvas/90 backdrop-blur transition-transform duration-200 pt-safe",
        hidden && !pinned && "max-md:-translate-y-full",
        mobileOnly && "nav-menu-header",
      )}
    >
      {children}
    </header>
  );
}
