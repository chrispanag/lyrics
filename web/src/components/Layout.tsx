"use client";

import { LogIn } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { BottomBar } from "@/components/BottomBar";
import {
  currentEntry,
  NAV_ITEMS,
  type NavItem,
  offeredTo,
  useWarmLists,
} from "@/components/navItems";
import { stickyBarClasses, useStickyBar } from "@/components/stickyBar";
import { BrandMark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";
import { Link, NavLink, usePathname, useSearchParams } from "@/lib/navigation";
import { revealChrome } from "@/lib/scrollChrome";
import { SITE_NAME } from "@/lib/site";

/**
 * A rail entry: a square as tall as the search field and a song's tools,
 * `group` for its label. Lit, it takes the accent's tint; at rest it shades
 * under the pointer and keeps `rest`, its own text color, if any.
 */
function railEntryClass(lit: boolean, rest?: string): string {
  return cn(
    "group relative grid size-12 place-items-center rounded-control transition-colors",
    lit ? "bg-accent-subtle text-fg-accent-subtle" : cn("hover:bg-subtle", rest),
  );
}

/**
 * App shell: a rail of icons from `md` up, and below it the bottom bar
 * (`BottomBar`), which carries the same navigation and the search.
 */
export function Layout({ children }: { children?: ReactNode }) {
  const pathname = usePathname();

  // Route changes start at the top, with the chrome out. Keyed on `pathname`
  // so a filter written into the query string does not scroll the catalog.
  // The reveal does not wait for the scroll's event, which a page already at
  // the top never fires.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger, not a value read.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    revealChrome();
  }, [pathname]);

  return (
    <div className="min-h-dvh md:flex">
      <NavRail />

      {/* `app` is the content column. The list and the lyrics become two
          panes once it is wide enough. The bottom room on a phone is what the
          bar floating over the page covers (`--bottom-bar-clearance`) and a
          little more, so the last lyric line, the end of a list and its
          infinite-scroll trigger all scroll clear of the bar. index.css takes
          it off once the panes are up, or the window would scroll past them. */}
      <main className="@container/app min-w-0 flex-1">
        {/* No Suspense boundary here: a server streams the shell the moment
            one sits above a page, so a page's `notFound()` or redirect
            arrives as a 200 with a meta tag rather than a 404 or a 308. */}
        <div className="app-column pb-[calc(var(--bottom-bar-clearance)+--spacing(4))] md:pb-8">
          {children}
        </div>
      </main>

      <BottomBar />
    </div>
  );
}

/**
 * An entry's name, drawn as a label beside the rail while the entry is hovered
 * or has visible focus. Hidden by opacity alone, so it stays the link's
 * accessible name.
 */
function RailLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-1/2 left-full z-floating ml-2 -translate-y-1/2",
        "rounded-compact bg-fg px-2.5 py-1.5 text-left text-xs font-medium whitespace-nowrap text-canvas",
        "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:transition-opacity",
        // Forced colors paints over the fill, which leaves the text floating.
        "forced-colors:border",
      )}
    >
      {children}
    </span>
  );
}

/**
 * One of the rail's links. The Lists link starts loading the lists on hover,
 * press or focus (`useWarmLists`). Lit when it is the `currentEntry`.
 */
function RailEntry({ item, active }: { item: NavItem; active: boolean }) {
  // Only the Lists link carries the handlers (see the spread below), and
  // `NavRail` shows it only to a signed-in reader.
  const intent = useWarmLists();

  return (
    <NavLink
      href={item.to}
      active={active}
      data-guest-only={item.identityCard || undefined}
      {...(item.warmsLists ? intent : undefined)}
      className={({ isActive }) => railEntryClass(isActive, "text-fg-tertiary")}
    >
      <item.icon aria-hidden className="size-5" />
      <RailLabel>{item.label}</RailLabel>
    </NavLink>
  );
}

/**
 * The navigation from `md` up: the brand's mark, which leads home, an icon for
 * each entry, and at its foot the reader's picture, which leads to their
 * profile, or Sign in. Each entry's name shows beside it on hover and focus.
 *
 * It sits on the page's own color with no rule of its own, so it frames the
 * screen rather than reading as one of its columns. Below `md` the bottom bar
 * is the navigation, and the rail is not drawn.
 */
function NavRail() {
  const { user } = useAuth();
  const current = currentEntry(usePathname(), useSearchParams(), user, { phone: false });

  // Only a guest, who has no picture to press, keeps the Profile link.
  const links = NAV_ITEMS.filter((item) => offeredTo(item, user) && !(item.identityCard && user));

  return (
    // `z-sticky` lifts the labels, which reach past the rail, over the page's
    // sticky headers. The top room is the reader frame's inset and the
    // header's `py-3`, so the brand's mark centers on the search field beside
    // it.
    <aside className="sticky top-0 z-sticky hidden h-dvh w-16 shrink-0 flex-col items-center pt-[calc(var(--reader-inset)+--spacing(3))] pb-4 md:flex">
      {/* `mb-6` sets the brand apart from the entries under it. */}
      <Link href="/" aria-label={SITE_NAME} className={cn(railEntryClass(false), "mb-6")}>
        <BrandMark />
      </Link>

      {/* The picture stays inside the <nav> landmark: it is the way to
          `/profile`. `flex-1` gives the `mt-auto` below room to reach the
          bottom. */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {links.map((item) => (
          <RailEntry key={item.to} item={item} active={item === current} />
        ))}

        <div className="mt-auto pt-6">
          {user ? (
            <NavLink
              href="/profile"
              active={current?.identityCard === true}
              className={({ isActive }) => railEntryClass(isActive)}
            >
              <Avatar user={user} />
              <RailLabel>
                <span className="block">{user.display_name ?? user.email}</span>
                <span className="block font-normal capitalize opacity-75">{user.role}</span>
              </RailLabel>
            </NavLink>
          ) : (
            <Link href="/login" data-guest-only className={railEntryClass(false, "text-fg-accent")}>
              <LogIn aria-hidden className="size-5" />
              <RailLabel>Sign in</RailLabel>
            </Link>
          )}
        </div>
      </nav>
    </aside>
  );
}

/**
 * A sticky page header that gets out of the way on a phone, together with the
 * rest of the phone's chrome (`stickyBarClasses`, `useStickyBar`).
 *
 * `pinned` holds it still, for a header with something anchored to it.
 */
export function StickyHeader({
  children,
  pinned,
}: {
  children: ReactNode;
  pinned?: boolean | undefined;
}) {
  const ref = useRef<HTMLElement>(null);
  useStickyBar(ref, { tucks: !pinned });

  return (
    <header
      ref={ref}
      // Read by index.css, which keeps focus inside the header from scrolling.
      data-sticky-header
      className={stickyBarClasses({ tucks: !pinned })}
    >
      {children}
    </header>
  );
}
