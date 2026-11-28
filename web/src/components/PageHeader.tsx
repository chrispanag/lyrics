import type { ReactNode } from "react";

import { pageTitle } from "./textStyles";
import { cn } from "@/lib/cn";

/**
 * The heading of a single-column page: the lists index, Admin, a guest's
 * Profile and the song editor. It renders the screen's one h1, so a page
 * renders one of these.
 *
 * The reader panes (a list, Browse, a song) do not use it: their way back and
 * their actions sit in a sticky toolbar, and their titles are what is read.
 *
 * `actions` sit opposite the title and wrap beneath it when the two do not fit
 * on one line, as on a phone.
 *
 * It does not name the browser tab: pair it with a `PageTitle`, which a page
 * renders on its waiting and error branches too, where there is no header.
 * `cn` is a plain join: `className` may only add non-colliding utilities, such
 * as the gap to what follows, which each page sets for itself.
 */
export function PageHeader({
  title,
  actions,
  className,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      {/* `grow`: the title takes the free space, so a long one wraps against
          the row's whole width before the actions drop beneath it. */}
      <div className="min-w-0 grow">
        <h1 className={pageTitle}>{title}</h1>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
