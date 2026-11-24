"use client";

import { Menu, PanelLeftClose } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { BottomBar } from "@/components/BottomBar";
import { buttonClasses } from "@/components/buttonStyles";
import { NAV_ITEMS, type NavItem, offeredTo, useWarmLists } from "@/components/navItems";
import { Button } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";
import { applyNavCollapsed, storeNavCollapsed, storedNavCollapsed } from "@/lib/navCollapsed";
import { songSection } from "@/lib/listContext";
import { Link, NavLink, usePathname, useSearchParams } from "@/lib/navigation";
import { useChromeTucked } from "@/lib/scrollChrome";

/**
 * The lit and pressable treatments shared by the nav links and the identity
 * card. Only the lit one carries a text color: at rest the card inherits.
 */
const SIDEBAR_ACTIVE = "bg-accent-subtle text-fg-accent-subtle";
const SIDEBAR_HOVER = "hover:bg-subtle";

/** The column's id, so opening it can move focus onto its first link. */
const NAV_SIDEBAR_ID = "nav-sidebar";

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

/** Brings the column back and moves focus onto its first link. */
function showNavigation() {
  applyNavCollapsed(false);
  storeNavCollapsed(false);
  focusFirst(`#${NAV_SIDEBAR_ID} a`);
}

/**
 * App shell: a navigation column from `md` up, which the reader can collapse,
 * and below it the bottom bar (`BottomBar`), which carries the same
 * navigation and the search.
 */
export function Layout({ children }: { children?: ReactNode }) {
  const pathname = usePathname();

  // Route changes start at the top. Keyed on `pathname` so a filter written
  // into the query string does not scroll the catalog.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger, not a value read.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  // The boot script paints the stored choice. A tree mounted without that
  // script — a story, a spec — applies it here, before paint.
  useLayoutEffect(() => {
    applyNavCollapsed(storedNavCollapsed());
  }, []);

  return (
    <div className="min-h-dvh md:flex">
      <DesktopSidebar />

      {/* `app` is the content column. The list and the lyrics become two
          panes once it is wide enough, which collapsing the navigation is
          what makes true on a narrower window. The bottom room on a phone is
          the bar floating over the page plus the home indicator under it, so
          the last lyric line, the end of a list and its infinite-scroll
          trigger all scroll clear of the bar. index.css takes it off once the
          panes are up, or the window would scroll past them. */}
      <main className="@container/app min-w-0 flex-1">
        {/* No Suspense boundary here: a server streams the shell the moment
            one sits above a page, so a page's `notFound()` or redirect
            arrives as a 200 with a meta tag rather than a 404 or a 308. */}
        <div className="app-column pb-[calc(--spacing(24)+env(safe-area-inset-bottom))] md:pb-8">
          {children}
        </div>
      </main>

      <BottomBar />
    </div>
  );
}

/**
 * One of the navigation's links. The Lists link starts loading the lists on
 * hover, press or focus (`useWarmLists`).
 *
 * `section` is the entry an open song belongs to (`songSection`), or
 * undefined anywhere else, where the link's own path decides.
 */
function NavEntry({ item, section }: { item: NavItem; section: string | undefined }) {
  // Only the Lists link carries the handlers (see the spread below), and
  // `NavPanel` shows it only to a signed-in reader.
  const intent = useWarmLists();

  return (
    <NavLink
      href={item.to}
      active={section === undefined ? undefined : section === item.to}
      data-guest-only={item.identityCard || undefined}
      {...(item.warmsLists ? intent : undefined)}
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
 * The column's navigation: the wordmark, the links, and the identity card or
 * the Sign in button at its foot.
 */
function NavPanel({ wordmarkTrailing }: { wordmarkTrailing?: ReactNode }) {
  const { user } = useAuth();
  const section = songSection(usePathname(), useSearchParams());

  // Only a guest, who has no card, keeps the Profile link.
  const links = NAV_ITEMS.filter((item) => offeredTo(item, user) && !(item.identityCard && user));

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
          <NavEntry key={item.to} item={item} section={section} />
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

/**
 * Opens the navigation column again once the reader has collapsed it.
 * Rendered by the page's own header bar, since the shell has no row of its
 * own.
 *
 * From `md` up the column is the navigation, so the button is hidden
 * (index.css) until the reader collapses the column. Below `md` it is hidden
 * too: the bottom bar is the navigation there.
 */
export function MenuButton() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={showNavigation}
      aria-label="Open menu"
      aria-controls={NAV_SIDEBAR_ID}
      className="nav-menu-button shrink-0"
    >
      <Menu aria-hidden className="size-5" />
    </Button>
  );
}

/**
 * A sticky page header that gets out of the way on a phone.
 *
 * Hides on scroll down and returns on scroll up, below `md` only, together
 * with the rest of the phone's chrome (`useChromeTucked`): the `max-md:`
 * prefix does that in CSS rather than tracking `matchMedia`, whose answer
 * would have to be kept in step with a window resized across the breakpoint.
 *
 * `pinned` holds it still, for a header with something anchored to it.
 *
 * `mobileOnly` goes on the `<header>` itself, since a bordered box with a
 * hidden child still draws a hairline. Shown only from `md` up and only while
 * the column is collapsed, when the bar is the way back to the navigation on a
 * screen that has no search box (index.css).
 *
 * Its height is published as `--sticky-header-height` on `<html>`, which the
 * root's `scroll-padding-top` reads, so a control reached by Tab is scrolled
 * clear of the header rather than to the viewport edge underneath it. Measured
 * rather than written down: the catalog's filter chips change the height, and
 * a `mobileOnly` header that is put away is `display: none` and measures 0.
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
  const hidden = useChromeTucked();
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

  return (
    <header
      ref={ref}
      // Read by index.css, which keeps focus inside the header from scrolling.
      data-sticky-header
      className={cn(
        "sticky top-0 z-sticky border-b border-line bg-canvas/90 backdrop-blur transition-transform duration-200 pt-safe",
        // Never away while it holds focus: a Tab into it must land on screen.
        hidden && !pinned && "max-md:-translate-y-full max-md:focus-within:translate-y-0",
        mobileOnly && "nav-menu-header",
      )}
    >
      {children}
    </header>
  );
}
