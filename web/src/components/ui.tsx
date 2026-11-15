"use client";

import { type ComponentProps, createContext, type ReactNode, useContext, useId } from "react";
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
// primitive, since `cn` cannot override a shared class.
const fieldLayout = "rounded-control";

/**
 * The id of the text a `Field` is showing under its control, error or hint.
 * Read by the primitives rather than wired by each caller: by hand, nothing
 * failed when a caller forgot, and several did.
 */
const FieldDescription = createContext<string | undefined>(undefined);

/** The field's description, plus any the caller names, without repeats. */
function useDescribedBy(own: string | undefined): string | undefined {
  const field = useContext(FieldDescription);
  const ids = new Set([field, ...(own?.split(/\s+/) ?? [])].filter(Boolean));
  return ids.size > 0 ? [...ids].join(" ") : undefined;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(fieldChrome, fieldLayout, "h-11 w-full px-3", className)}
      {...props}
      aria-describedby={useDescribedBy(props["aria-describedby"])}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldChrome, fieldLayout, "w-full px-3 py-2.5", className)}
      {...props}
      aria-describedby={useDescribedBy(props["aria-describedby"])}
    />
  );
}

// The native arrow ignores the field's padding, sits hard against the border
// and is drawn at each engine's own size, so it is switched off and replaced.
// An icon rather than a background image, so its color follows the theme.
// `className` sizes the wrapper, which is what a caller's width has to reach.
// The select inherits `text-transform` from it explicitly: the UA stylesheet
// resets it on form controls, so a caller's `capitalize` would stop there.
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          fieldChrome,
          fieldLayout,
          "peer h-11 w-full appearance-none pl-3 pr-9 [text-transform:inherit]",
        )}
        {...props}
        aria-describedby={useDescribedBy(props["aria-describedby"])}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted peer-disabled:opacity-50"
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
  // An error replaces the hint, on screen and in what the control announces.
  const described = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg-secondary">
        {label}
      </label>
      <Described by={described}>{children}</Described>
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${htmlFor}-error`}>{error}</FieldError>}
    </div>
  );
}

/**
 * Points the primitives inside it at `by`, the way Field points its own control.
 * For a control with no Field around it: wrap the one the text is about, not a
 * whole row, or every control in the row is described by it.
 */
export function Described({ by, children }: { by: string | undefined; children: ReactNode }) {
  return <FieldDescription value={by}>{children}</FieldDescription>;
}

/**
 * A server error under the control it names. Field renders its own; a row of
 * controls with no Field around it renders this, and wraps that control in
 * `Described` with the same id.
 */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-xs font-medium text-fg-danger">
      {children}
    </p>
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
    active ? "bg-accent text-fg-on-fill" : "bg-muted text-fg-secondary",
    onClick && "cursor-pointer hover:opacity-80",
  );

  // A real button when clickable; not always, since a chip with onRemove
  // already contains one and buttons cannot nest. A clickable chip is a toggle.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={Boolean(active)} className={classes}>
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
          className="-mr-1 rounded-full p-0.5 hover:bg-current/10"
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
      <LoaderCircle aria-hidden className="size-6 animate-spin text-fg-subtle" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-compact bg-muted", className)} />;
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
      {icon && <div className="text-fg-subtle">{icon}</div>}
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {description && <p className="max-w-sm text-sm text-fg-muted">{description}</p>}
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
    <p role="status" className="text-sm text-fg-secondary">
      {children}
    </p>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-control border border-line-danger bg-danger-subtle px-4 py-3 text-sm text-fg-danger-subtle"
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
      // A transparent `.dialog-viewport` over the whole screen, so the page
      // behind cannot scroll (see index.css); the dimming is still `::backdrop`.
      className="dialog-viewport border-0 p-0 text-inherit backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      <div className="dialog-track">
        <div data-dialog-dismiss aria-hidden />
        <div
          className={cn(
            // Pinned to the bottom, centered from `sm`. Sticky to the viewport's
            // edge, since the track is a pixel taller than it.
            "sticky bottom-0 mt-auto flex max-h-[85dvh] w-full flex-col",
            "rounded-t-sheet bg-surface shadow-sheet",
            "sm:mx-auto sm:my-auto sm:max-w-lg sm:rounded-sheet",
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-2 text-fg-muted hover:bg-subtle"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          {/* Not `py-4 pb-safe`: as utilities, the later `pb-safe` wins and is 0
              wherever there is no inset, leaving the body no bottom padding. */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(--spacing(4),env(safe-area-inset-bottom))]">
            {shown && children}
          </div>
        </div>
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
      <div className="text-sm text-fg-tertiary">{children}</div>
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
