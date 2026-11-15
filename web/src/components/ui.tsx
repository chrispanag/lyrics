import { type ComponentProps, type ReactNode, useId } from "react";
import { ChevronDown, LoaderCircle, X } from "lucide-react";

import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonStyles";
import { fieldChrome } from "@/components/fieldStyles";
import { cn } from "@/lib/cn";
import { useDialog } from "@/lib/modal";

/* Shared primitives. Touch-target sizing lives in buttonStyles.ts. */

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean | undefined;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      // A button that is busy must also be unclickable, or a double tap
      // submits twice.
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {loading && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

// The shape the field primitives share. Size, padding and width are stated per
// primitive, since `cn` cannot override a shared class. <Select> sets no width:
// its caller does.
const fieldLayout = "rounded-xl";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input className={cn(fieldChrome, fieldLayout, "h-11 w-full px-3", className)} {...props} />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldChrome, fieldLayout, "w-full px-3 py-2.5", className)}
      {...props}
    />
  );
}

// The native arrow ignores the field's padding, sits hard against the border
// and is drawn at each engine's own size, so it is switched off and replaced.
// An icon rather than a background image, so its color follows the theme.
// `className` sizes the wrapper, which is what a caller's width has to reach.
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(fieldChrome, fieldLayout, "peer h-11 w-full appearance-none pl-3 pr-9")}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-stone-500 peer-disabled:opacity-50 dark:text-stone-400"
      />
    </div>
  );
}

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
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-stone-700 dark:text-stone-300"
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-stone-500 dark:text-stone-400">
          {hint}
        </p>
      )}
      {error && (
        // Callers point the control at these ids with aria-describedby.
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-xs font-medium text-red-600 dark:text-red-400"
        >
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

  // A real button when clickable; not always, since a chip with onRemove
  // already contains one and buttons cannot nest.
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
      <LoaderCircle aria-hidden className="size-6 animate-spin text-stone-400" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-lg bg-stone-200 dark:bg-stone-800", className)}
    />
  );
}

/**
 * A stack of placeholder rows for a list still loading. `className` styles each
 * row; `stackClassName` is the stack's own, a `space-y-*` class.
 */
export function Skeletons({
  count,
  className,
  stackClassName = "space-y-3",
}: {
  count: number;
  className: string;
  stackClassName?: string;
}) {
  return (
    <div className={stackClassName}>
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders with nothing else to key on.
        <Skeleton key={index} className={className} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string | undefined;
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
 * A bottom sheet on mobile (within thumb reach), a centered dialog on larger
 * screens: a native `<dialog>` opened with `showModal()`, so the browser makes
 * the page inert, moves focus in, closes on Escape and hands focus back to the
 * opener. It stays mounted while closed, because `close()` is what does that
 * last part; the content does not, so a sheet still opens fresh.
 *
 * The header is always there, so `showModal()` starts focus on Close; the
 * content mounts once the dialog is open, so an `autoFocus` field in it then
 * takes focus without being mistaken for the opener (`useDialog`).
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
  const [dialog, shown] = useDialog({ open, onClose });
  const titleId = useId();

  return (
    <dialog
      {...dialog}
      aria-labelledby={titleId}
      className={cn(
        // The UA's modal box reset to the sheet's: full width and pinned to the
        // bottom, centered from `sm`. The margins are stated because preflight
        // zeroes the UA's `auto`, which is what places a modal dialog at all.
        // `display` only while open, or it would override the closed state.
        "m-auto mb-0 max-h-[85dvh] w-full max-w-full flex-col border-0 p-0 text-inherit open:flex",
        "rounded-t-3xl bg-white shadow-2xl",
        "sm:mb-auto sm:max-w-lg sm:rounded-3xl",
        "dark:bg-stone-900",
        "backdrop:bg-black/40 backdrop:backdrop-blur-sm",
      )}
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 dark:border-stone-800">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-safe">
        {shown && children}
      </div>
    </dialog>
  );
}

/**
 * A sheet that asks before something irreversible happens.
 *
 * `error` shows a refusal without closing the sheet.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  children,
  confirmLabel = "Delete",
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="text-sm text-stone-600 dark:text-stone-400">{children}</div>
      {error && (
        <div className="mt-4">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" className="flex-1" loading={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
