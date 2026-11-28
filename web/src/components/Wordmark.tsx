import { BrandIcon } from "@/components/brandIcon";

import { cn } from "@/lib/cn";
import { SITE_NAME } from "@/lib/site";

/**
 * The product name beside its mark.
 *
 * `size` selects a whole class: `cn()` is a plain join and cannot override.
 */
const markSizes = {
  /** The navigation rail, where it heads a column of icons. */
  md: "size-7",
  /** Auth screens, where it is the only thing above the heading. */
  lg: "size-8",
};

/**
 * The mark alone, decorative: whatever holds it carries the name (the rail's
 * home link labels itself with it).
 */
export function BrandMark({ size = "md" }: { size?: keyof typeof markSizes }) {
  // The fill token, not `fg-accent`: the mark is the brand's own color in both
  // themes, like the icons drawn from it.
  return <BrandIcon aria-hidden className={cn(markSizes[size], "text-accent")} />;
}

export function Wordmark({ size = "md" }: { size?: keyof typeof markSizes }) {
  // inline-flex so a `text-center` parent (the auth screens) centers it.
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={size} />
      <span className="text-xl font-semibold tracking-tight">{SITE_NAME}</span>
    </span>
  );
}
