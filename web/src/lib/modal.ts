import { useEffect, type RefObject } from "react";

/*
 * What a modal is, asked of the DOM so every modal is covered, and the hook that
 * marks one. Page gestures stand down while one is open. Modals take their
 * marking from `useModal` rather than writing it, so a move to `<dialog>` is a
 * change to this module alone.
 */
const OPEN_MODAL = '[role="dialog"][aria-modal="true"]';

/** Whether a modal is currently open anywhere on the page. */
export function modalIsOpen(): boolean {
  return document.querySelector(OPEN_MODAL) !== null;
}

/** The marking `modalIsOpen` looks for, resolved for the current state. */
export interface ModalMarking {
  role?: "dialog";
  "aria-modal"?: true;
}

/**
 * Escape, the scroll lock, focus, and the marking above.
 *
 * **Two effects with different keys**: `onClose` is an inline closure at every
 * call site, so the first effect re-runs on any parent render, and a focus
 * restore in its cleanup would pull focus out of the open dialog.
 *
 * Focus returns to the opener on close either way; `focus` is only needed by a
 * modal that stays mounted.
 */
export function useModal({
  open,
  onClose,
  focus,
}: {
  open: boolean;
  onClose: () => void;
  /** Given focus while the modal is up, for a modal that stays mounted. */
  focus?: RefObject<HTMLElement | null>;
}): ModalMarking {
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

  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement;
    focus?.current?.focus();

    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
    // `open` alone is the key; `focus` is a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return open ? { role: "dialog", "aria-modal": true } : {};
}
