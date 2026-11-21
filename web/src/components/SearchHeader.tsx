"use client";

import type { ReactNode } from "react";

import { MenuButton, StickyHeader } from "./Layout";

/** The column both bars share, so the hamburger never moves between screens. */
const headerColumn = "mx-auto max-w-3xl px-4 py-3";

/**
 * The header a search box sits in, shared by the catalog and a song page.
 *
 * It owns the sticky chrome, the column, the field's `flex-1` share and the
 * leading hamburger, so no page can make the field move under the finger
 * between screens. See "Frontend" in CLAUDE.md.
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
 * The same bar for a screen with no search box of its own: the hamburger, in
 * the place every other screen keeps it. `mobileOnly`, since at a desk the
 * sidebar is the navigation until the reader collapses it, and then this bar
 * is the way back.
 *
 * Applied by the `(menu)` route group's layout, not per page, so no screen or state
 * can forget it.
 */
export function MenuHeader() {
  return (
    <StickyHeader mobileOnly>
      <div className={headerColumn}>
        <MenuButton />
      </div>
    </StickyHeader>
  );
}
