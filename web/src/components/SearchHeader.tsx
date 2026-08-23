import type { ReactNode } from "react";

import { MenuButton, StickyHeader } from "./Layout";

/**
 * The column both bars below put their contents in.
 *
 * One string rather than two copies of it, for the reason this whole component
 * exists: retuned in one place only, the measure or the padding would move the
 * hamburger sideways — or change the bar's height — between a song page and the
 * list it was opened from, which is the movement under the finger the component
 * was written to stop, arriving from inside it this time.
 */
const headerColumn = "mx-auto max-w-3xl px-4 py-3";

/**
 * The header a search box sits in, shared by the catalog and a song page.
 *
 * It owns the sticky chrome, the column and the row, because a page owning any
 * of them is what the search field moved for: the catalog's column was
 * `max-w-3xl` against the song page's `max-w-2xl`, so opening a song slid the
 * field sideways and resized it at once, under the finger that had just tapped
 * the row. Rendering `StickyHeader` here rather than beside it is what leaves no
 * page anywhere with its own column inside the sticky chrome — the arrangement
 * that produced the bug is not writable, which is worth more than a spec saying
 * not to. `pinned` is passed through for the one caller that needs it, and
 * `StickyHeader` stays exported for its own specs and for a sticky header that
 * one day holds something other than a search box.
 *
 * The field's share of the row is this component's too, `flex-1` and all: a
 * caller stating its own proportion is the same divergence one level down, and
 * the field would shrink to fit its placeholder on the page that forgot.
 *
 * `trailing` is the catalog's filter button, and it is deliberately *not* a
 * reserved slot — the row's `gap` alone would cost 8px, so it is rendered only
 * when there is something to put in it. A page with no control beside its field
 * lets the field take that width instead, which is what keeps the box centered
 * in the column rather than sitting a half-button left of center. So the right
 * edge is the one thing a page carrying a control cannot share: centered on
 * every screen is worth more than identical to the pixel.
 *
 * What must not vary is that control's *width*, since the field is whatever the
 * row has left. Which is why the filter count is a badge over a square button
 * rather than text beside its icon: as text it widened the button and narrowed
 * the field, resizing the box in place every time a filter was applied.
 *
 * The hamburger leading the row is the same rule from the other side: it is
 * rendered here, unconditionally, rather than passed in — a page that had the
 * choice would be a page whose field starts 52px further left than the next
 * one's, which is the movement under the finger this component exists to stop.
 * A page with no search box of its own gets `MenuHeader` below, so the button
 * lands in the same place on every screen in the app.
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
  pinned?: boolean;
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
 * the place every other screen keeps it.
 *
 * It shares `StickyHeader` and the column above rather than stating either
 * again, which is what makes "the way into the navigation is always here" true
 * by construction instead of by six pages agreeing on a number. Nothing is at
 * the right of the row on purpose — a screen with something to put there has a
 * header of its own already.
 *
 * `mobileOnly`, because at a desk this bar has nothing in it: the sidebar is
 * the navigation there, and a header rendered anyway would be an empty
 * hairline across the top of two thirds of the app.
 *
 * It is applied by position, as the element of a layout route wrapping every
 * screen that needs one — see `App.tsx`. A page that carried this itself would
 * have to carry it in every state it can be in, and `ListDetailPage` alone has
 * three; one forgotten leaves that screen with no navigation at all on a phone,
 * which is exactly the failure the tab bar could not have.
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
