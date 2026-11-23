import type { ReactNode } from "react";

import { sectionLabel } from "./textStyles";
import { cn } from "@/lib/cn";

/**
 * The heading of a single-column page: the lists index, Admin, Profile and the
 * song editor. It renders the screen's one h1, so a page renders one of these.
 *
 * The reader panes (a list, Browse, a song) do not use it: their way back and
 * their actions sit in a sticky toolbar, and their titles are what is read.
 *
 * Above the title goes either an `eyebrow`, naming the section the screen
 * belongs to, or a `back` control, never both. `actions` sit opposite the
 * title and wrap beneath it when the two do not fit on one line, as on a phone.
 *
 * It does not name the browser tab: pair it with a `PageTitle`, which a page
 * renders on its waiting and error branches too, where there is no header.
 * `cn` is a plain join: `className` may only add non-colliding utilities, such
 * as the gap to what follows, which each page sets for itself.
 */
export function PageHeader({
  title,
  eyebrow,
  back,
  actions,
  className,
}: {
  title: string;
  eyebrow?: string | undefined;
  back?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    // `grow` lets a centered page center the title, which would otherwise sit
    // at the start of a box only as wide as its text.
    <header className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0 grow">
        {back && <div className="mb-1">{back}</div>}
        {eyebrow && <p className={cn(sectionLabel, "mb-1")}>{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-balance break-words">{title}</h1>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
