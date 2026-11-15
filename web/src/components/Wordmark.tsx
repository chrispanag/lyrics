import { Disc3 } from "lucide-react";

import { cn } from "@/lib/cn";
import { SITE_NAME } from "@/lib/site";

/**
 * The product name beside its mark.
 *
 * `size` selects a whole class: `cn()` is a plain join and cannot override.
 */
const markSizes = {
  /** Sidebar, where it heads a column of nav labels. */
  md: "size-7",
  /** Auth screens, where it is the only thing above the heading. */
  lg: "size-8",
};

export function Wordmark({ size = "md" }: { size?: keyof typeof markSizes }) {
  // inline-flex so a `text-center` parent (the auth screens) centers it.
  return (
    <span className="inline-flex items-center gap-2">
      <Disc3 aria-hidden className={cn(markSizes[size], "text-brand-600")} />
      <span className="text-xl font-semibold tracking-tight">{SITE_NAME}</span>
    </span>
  );
}
