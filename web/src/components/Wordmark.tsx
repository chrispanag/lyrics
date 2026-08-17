import { Disc3 } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * The product name beside its mark.
 *
 * Shared so a rename cannot reach one screen and miss the other — that failure
 * is silent, since a sidebar still renders perfectly well carrying last year's
 * name. The mark and the name travel together for the same reason: the auth
 * screens showed the disc alone for a while, which told a new visitor nothing
 * about what they were signing up to.
 *
 * `size` selects a whole class rather than merging over a default: `cn()` is a
 * plain join, so an override would leave both size classes in the list and let
 * CSS source order pick the winner.
 */
const markSizes = {
  /** Sidebar, where it heads a column of nav labels. */
  md: "size-7",
  /** Auth screens, where it is the only thing above the heading. */
  lg: "size-8",
};

export function Wordmark({ size = "md" }: { size?: keyof typeof markSizes }) {
  // inline-flex rather than flex so a `text-center` parent centers it — the
  // auth screens rely on that, and it costs the sidebar nothing.
  return (
    <span className="inline-flex items-center gap-2">
      <Disc3 aria-hidden className={cn(markSizes[size], "text-brand-600")} />
      <span className="text-xl font-semibold tracking-tight">Songfolio</span>
    </span>
  );
}
