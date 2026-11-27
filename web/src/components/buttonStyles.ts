import { cn } from "@/lib/cn";

/*
 * Button styling, shared with links that look like buttons. Kept out of ui.tsx,
 * which exports only components so fast refresh keeps working.
 */

// Listed as values so the Primitives stories can offer every one of them.
export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
export const BUTTON_SIZES = ["sm", "md", "lg", "icon", "icon-sm"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = (typeof BUTTON_SIZES)[number];

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-fg-on-fill hover:bg-accent-hover active:bg-accent-active disabled:bg-accent/50",
  secondary: "bg-muted text-fg hover:bg-muted-hover active:bg-muted-active",
  ghost: "bg-transparent text-fg-secondary hover:bg-muted active:bg-muted-hover",
  danger: "bg-danger text-fg-on-fill hover:bg-danger-hover active:bg-danger-active",
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
  // Square, level with `sm`: a tool beside a heading, such as the lyrics'
  // text size, where a 44px square would tower over the row.
  "icon-sm": "size-9",
};

export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-control font-medium",
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
  "shrink-0 rounded-compact p-2 text-fg-subtle transition-colors focus-visible:ring-2 focus-visible:outline-hidden";

/**
 * The text of an action that shows as an icon alone on a phone. Hidden from
 * sight there, not removed, so it still names the control at every width and
 * a separate `aria-label` is needed only where the name says more than it.
 */
export const actionLabel = "sr-only sm:not-sr-only";

/**
 * `actionLabel` for a control in the pane beside the lyrics: hidden on a phone,
 * and hidden again once the pane sits beside a song, where its bar is a pane's
 * width.
 */
export const paneActionLabel = "sr-only sm:@max-3xl/app:not-sr-only";

/**
 * A segmented control: the track, and one segment in it. Shared by the theme
 * switch (radios) and the admin console's tabs (links), so a choice between
 * views looks the same wherever it is offered.
 */
export const segmentedTrack = "flex gap-1 rounded-control bg-muted p-1";

export function segmentClasses(selected: boolean, className?: string): string {
  return cn(
    "flex h-10 items-center justify-center gap-1.5 rounded-compact text-sm font-medium transition-colors",
    selected ? "bg-canvas text-fg shadow-raised" : "text-fg-tertiary hover:text-fg",
    className,
  );
}
