"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { MenuButton, StickyHeader } from "./Layout";
import { contentWidth } from "./Page";

/**
 * Inset of every sticky bar. The catalog's search and a song's tools are
 * neighbors from `lg` up, and this is what keeps their edges on one line.
 */
export const headerBarPadding = "px-4 py-3";

/**
 * The column both bars share, so the hamburger never moves between screens:
 * the content page's width, so it lines up with the page under it.
 */
const headerColumn = cn("mx-auto", contentWidth, headerBarPadding);

/**
 * The header a search box sits in, shared by the catalog and a song page.
 *
 * It owns the sticky chrome, the column, the field's `flex-1` share and the
 * leading hamburger, so no page can make the field move under the finger
 * between screens. The hamburger shows only from `md` up with the column
 * collapsed (index.css); a phone's navigation is the bottom bar.
 *
 * `trailing` is not a reserved slot: with nothing beside it the field takes the
 * full width and stays centered. A trailing control must keep a fixed width,
 * since the field gets whatever is left.
 */
export function SearchHeader({
  children,
  trailing,
  below,
  pinned,
}: {
  /** The search box. Its width is the row's, minus anything beside it. */
  children: ReactNode;
  /** A control beside the field, which the row holds at its natural size. */
  trailing?: ReactNode;
  /** Under the row and inside the same column: the catalog's filter chips. */
  below?: ReactNode;
  /** Held still regardless of scrolling — see `StickyHeader`. */
  pinned?: boolean | undefined;
}) {
  return (
    <StickyHeader pinned={pinned}>
      <div className={headerColumn}>
        <div className="flex items-center gap-2">
          <MenuButton />
          <div className="min-w-0 flex-1">{children}</div>
          {trailing && <div className="shrink-0">{trailing}</div>}
        </div>
        {below}
      </div>
    </StickyHeader>
  );
}

/**
 * The same bar holding a screen's own controls where the search box would be:
 * a list's, in the pane the catalog takes beside a song. It shows at every
 * width, since beside the lyrics it is the pane's header, and the way to the
 * navigation once the column is collapsed. The row is as tall as the search
 * field, so the bar lines up with a song's tools across the reader.
 */
export function ToolbarHeader({ children }: { children: ReactNode }) {
  return (
    <StickyHeader>
      <div className={headerColumn}>
        <div className="flex h-12 items-center gap-2">
          <MenuButton />
          {children}
        </div>
      </div>
    </StickyHeader>
  );
}

/**
 * The same bar for a screen with no search box of its own: the hamburger, in
 * the place every other screen keeps it. From `md` up only, and only while the
 * column is collapsed, since the open column is the navigation and the bar
 * is then the way back to it. Below `md` the bottom bar is the navigation, and
 * all that is left here is the room the notch takes, which the bar's own
 * safe-area padding used to keep clear.
 *
 * Applied by the `(menu)` route group's layout, not per page, so no screen or state
 * can forget it.
 */
export function MenuHeader() {
  return (
    <>
      <div aria-hidden className="pt-safe md:hidden" />
      <StickyHeader collapsedOnly>
        <div className={headerColumn}>
          <MenuButton />
        </div>
      </StickyHeader>
    </>
  );
}
