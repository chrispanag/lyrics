import { cn } from "@/lib/cn";

/*
 * Button styling, shared with links that look like buttons. Kept out of ui.tsx,
 * which exports only components so fast refresh keeps working.
 */

// Listed as values so the Primitives stories can offer every one of them.
export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
export const BUTTON_SIZES = ["sm", "md", "lg", "icon"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = (typeof BUTTON_SIZES)[number];

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/50",
  secondary:
    "bg-stone-200 text-stone-900 hover:bg-stone-300 active:bg-stone-400 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700",
  ghost:
    "bg-transparent text-stone-700 hover:bg-stone-200 active:bg-stone-300 dark:text-stone-300 dark:hover:bg-stone-800",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};

// Every size but `sm` is at least 44px tall; below that, taps land on
// neighbors.
const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  // Square, level with `md`. A size rather than an override, since `cn` cannot
  // replace the padding.
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
 * handle on one side, the remove button on the other. Not `buttonClasses`,
 * whose padding and hover `cn` could not override. Each caller adds its own
 * accent, cursor and disabled treatment.
 */
export const rowControlChrome =
  "shrink-0 rounded-lg p-2 text-stone-400 transition-colors focus-visible:ring-2 focus-visible:outline-hidden";
