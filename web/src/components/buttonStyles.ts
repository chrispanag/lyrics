import { cn } from "@/lib/cn";

/*
 * Button styling, in its own module so it can be shared with elements that must
 * not be a <button>.
 *
 * Several places need a link that looks like a button — nesting an anchor inside
 * a button is invalid and breaks keyboard handling, so those render a <Link> and
 * borrow these classes instead of re-typing them. Kept out of ui.tsx because
 * that file exports only components, which is what keeps fast refresh working.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/50",
  secondary:
    "bg-stone-200 text-stone-900 hover:bg-stone-300 active:bg-stone-400 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700",
  ghost:
    "bg-transparent text-stone-700 hover:bg-stone-200 active:bg-stone-300 dark:text-stone-300 dark:hover:bg-stone-800",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};

// Every interactive control is at least 44px tall on touch — below that, taps
// land on neighbours.
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  // A button that is nothing but an icon: square, and 44px on each edge — the
  // touch floor named above, and `md`'s own height, so it sits level with a
  // labeled button beside it. It is a size rather than a caller's override because
  // horizontal padding is the one thing `cn` cannot replace — a plain join
  // leaves `px-4 px-3` both in the class list with CSS source order picking the
  // winner, so the width of an icon button written that way is whatever
  // Tailwind happened to emit last, which is no width to build a layout on.
  icon: "size-11",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    buttonVariants[variant],
    buttonSizes[size],
    className,
  );
}

/**
 * The chrome shared by the icon controls that flank a song in a list — the drag
 * handle on one side, the remove button on the other.
 *
 * They sit opposite each other on the same row, so their size and resting
 * colour have to agree, and stating that twice is how it stops being true: the
 * two had already drifted by a `transition-colors`. Deliberately not
 * `buttonClasses`, whose padding is horizontal and whose ghost variant brings a
 * grey hover that would have to be overridden — and `cn` is a plain join, so an
 * override is a second class for the same property rather than a replacement.
 * Each caller adds its own accent, cursor and disabled treatment.
 */
export const rowControlChrome =
  "shrink-0 rounded-lg p-2 text-stone-400 transition-colors focus-visible:ring-2 focus-visible:outline-none";
