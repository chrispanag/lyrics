import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Loader2, X } from "lucide-react";

import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonStyles";
import { fieldChrome } from "@/components/fieldStyles";
import { cn } from "@/lib/cn";

/*
 * Shared primitives. Every interactive control is at least 44px tall on
 * touch — below that, taps land on neighbours.
 */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // A button that is busy must also be unclickable, or a double tap
      // submits twice.
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

// The shape the three field primitives share; the chrome they share with the
// browse search box lives in fieldStyles. Everything a call site might vary —
// size, padding, width — is stated by the primitive itself rather than shared
// here, because cn is a plain join: two classes for one property both land in
// the list and CSS source order picks the winner.
//
// That is not hypothetical. A shared `w-full` outranked the `w-36` the credit
// editor passes for its role picker, so that row rendered with the person
// field crushed to a sliver and the picker swallowing the rest — while the
// admin filter's `sm:w-44` survived the same collision, since a variant is
// always emitted after the base utility it qualifies. Width now belongs to
// whoever places the control: an <Input> or <Textarea> always fills its field,
// a <Select> sits in a toolbar or beside another control just as often, so it
// asks. A select that forgets is visibly shrink-to-fit, not subtly wrong.
const fieldLayout = "rounded-xl";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(fieldChrome, fieldLayout, "h-11 w-full px-3", className)}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(fieldChrome, fieldLayout, "w-full px-3 py-2.5", className)}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        // select-chevron draws the arrow the native control would; see the rule
        // in styles/index.css for why that one is given up. No width here — see
        // fieldLayout.
        className={cn(fieldChrome, fieldLayout, "select-chevron h-11 appearance-none pl-3 pr-9", className)}
        {...props}
      >
        {children}
      </select>
    );
  },
);

/** A labelled form field with optional error and hint text. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-stone-500 dark:text-stone-400">
          {hint}
        </p>
      )}
      {error && (
        // role="alert" so a screen reader announces the failure without the
        // user having to hunt for it. Callers point the control at these ids
        // with aria-describedby.
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** A removable filter chip. */
export function Chip({
  children,
  onRemove,
  active,
  onClick,
}: {
  children: ReactNode;
  onRemove?: () => void;
  active?: boolean;
  onClick?: () => void;
}) {
  const classes = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm transition-colors",
    active
      ? "bg-brand-600 text-white"
      : "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    onClick && "cursor-pointer hover:opacity-80",
  );

  // A clickable chip is a real button rather than a span wearing role="button":
  // that gets focus, Enter, and Space from the platform instead of hand-rolled
  // key handling. It stays conditional because a chip with onRemove already
  // contains a button, and buttons cannot nest.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {children}
      </button>
    );
  }

  return (
    <span className={classes}>
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove filter"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="-mr-1 rounded-full p-0.5 hover:bg-black/10"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex justify-center py-8", className)}>
      <Loader2 aria-hidden className="size-6 animate-spin text-stone-400" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-stone-200 dark:bg-stone-800", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-stone-300 dark:text-stone-700">{icon}</div>}
      <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200">{title}</h2>
      {description && (
        <p className="max-w-sm text-sm text-stone-500 dark:text-stone-400">{description}</p>
      )}
      {action}
    </div>
  );
}

/**
 * A short confirmation — the positive counterpart to ErrorMessage.
 *
 * `role="status"` rather than `role="alert"`: worth announcing when the reader
 * reaches it, not worth interrupting them for.
 */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-sm text-stone-600 dark:text-stone-300">
      {children}
    </p>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
    >
      {children}
    </div>
  );
}

/**
 * A bottom sheet on mobile, a centered dialog on larger screens.
 *
 * Filters and pickers need a lot of vertical room on a phone; a sheet anchored
 * to the bottom keeps controls within thumb reach instead of at the top of a
 * tall screen.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  // Escape must close it, and the page behind must not scroll while it is up.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative flex max-h-[85vh] w-full flex-col rounded-t-3xl bg-white shadow-2xl",
          "sm:max-w-lg sm:rounded-3xl",
          "dark:bg-stone-900",
        )}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-safe">{children}</div>
      </div>
    </div>
  );
}
