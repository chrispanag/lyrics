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
import { litFill } from "@/components/cardStyles";
import { tabLabelText } from "@/components/textStyles";
import { BrandMark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";
import { Link, NavLink, usePathname, useSearchParams } from "@/lib/navigation";
import { revealChrome } from "@/lib/scrollChrome";
import { SITE_NAME } from "@/lib/site";

/**
 * A rail entry: a square as tall as the search field and a song's tools,
 * `group` for its label. Lit, it takes the accent's tint; at rest it shades
 * under the pointer and keeps `rest`, its own text color, if any.
 *
 * `named`: the entry carries a `RailCaption`, so on a touch screen the square
 * grows to hold it.
 */
function railEntryClass(lit: boolean, rest?: string, named = false): string {
  return cn(
    "group relative grid size-12 place-items-center rounded-control transition-colors",
    named &&
      "pointer-coarse:h-auto pointer-coarse:min-h-12 pointer-coarse:w-14 pointer-coarse:gap-0.5 pointer-coarse:py-1.5",
    litFill(lit),
    lit ? "text-fg-accent-subtle" : rest,
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
          infinite-scroll trigger all scroll clear of the bar. Once the column
          is `@3xl` every screen is set on sheets (`sheetFrame`), whose frame
          keeps its own inset below them, so the room goes: the reader would
          only scroll past its panes.

          Until then the column is the sheet itself, a window tall: a
          phone's screen, and the band beside the rail before the panes split,
          are the surface with their sticky bars on it (`sheet-surface`), as a
          desk's sheets are. One look for content at every width. */}
      <main className="@container/app min-w-0 flex-1">
        {/* No Suspense boundary here: a server streams the shell the moment
            one sits above a page, so a page's `notFound()` or redirect
            arrives as a 200 with a meta tag rather than a 404 or a 308. */}
        <div
          className={cn(
            "pb-[calc(var(--bottom-bar-clearance)+--spacing(4))] md:pb-8 @3xl/app:pb-0",
            "@max-3xl/app:min-h-dvh @max-3xl/app:sheet-surface",
          )}
        >
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
 *
 * `captioned`: the entry shows its name under its icon on a touch screen
 * (`RailCaption`), so there this label stays unseen even under keyboard focus,
 * rather than say the name twice. Still by opacity, so it still names the link.
 */
function RailLabel({ children, captioned = false }: { children: ReactNode; captioned?: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-1/2 left-full z-floating ml-2 -translate-y-1/2",
        "rounded-compact bg-fg px-2.5 py-1.5 text-left text-xs font-medium whitespace-nowrap text-canvas",
        "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:transition-opacity",
        captioned && "pointer-coarse:opacity-0!",
        // Forced colors paints over the fill, which leaves the text floating.
        "forced-colors:border",
      )}
    >
      {children}
    </span>
  );
}

/**
 * An entry's name under its icon, shown only on a touch screen
 * (`pointer-coarse`), where nothing hovers to bring up its `RailLabel`. Set as
 * the bottom bar's tabs set theirs on a phone. Hidden from assistive tech: the
 * `RailLabel` is the name. The brand's mark and the reader's picture have none:
 * they name themselves.
 */
function RailCaption({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn("hidden max-w-full truncate pointer-coarse:block", tabLabelText)}
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
      className={({ isActive }) => railEntryClass(isActive, "text-fg-tertiary", true)}
    >
      <item.icon aria-hidden className="size-5" />
      <RailLabel captioned>{item.label}</RailLabel>
      <RailCaption>{item.label}</RailCaption>
    </NavLink>
  );
}

/**
 * The navigation from `md` up: the brand's mark, which leads home, an icon for
 * each entry, and at its foot the reader's picture, which leads to their
 * profile, or Sign in. Each entry's name shows beside it on hover and focus,
 * and under it on a touch screen.
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
    // sticky headers. The top room is the sheets' inset and the
    // header's `py-3`, so the brand's mark centers on the search field beside
    // it.
    <aside className="sticky top-0 z-sticky hidden h-dvh w-16 shrink-0 flex-col items-center pt-[calc(var(--sheet-inset)+--spacing(3))] pb-4 md:flex">
      {/* Named by its label, as the other entries are. `mb-6` sets it apart
          from the entries under it. */}
      <Link href="/" className={cn(railEntryClass(false), "mb-6")}>
        <BrandMark />
        <RailLabel>{SITE_NAME}</RailLabel>
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
            <Link
              href="/login"
              data-guest-only
              className={railEntryClass(false, "text-fg-accent", true)}
            >
              <LogIn aria-hidden className="size-5" />
              <RailLabel captioned>Sign in</RailLabel>
              <RailCaption>Sign in</RailCaption>
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
