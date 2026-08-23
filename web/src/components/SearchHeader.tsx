import type { ReactNode } from "react";

import { StickyHeader } from "./Layout";

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
      <div className="mx-auto max-w-3xl px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          {trailing && <div className="shrink-0">{trailing}</div>}
        </div>
        {below}
      </div>
    </StickyHeader>
  );
}
