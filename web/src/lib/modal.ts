import { useEffect, type RefObject } from "react";

/*
 * What a modal is, asked of the DOM rather than of a page — and, below, the
 * behavior that makes the answer true.
 *
 * Two gestures have to ask this — the arrow keys and the paging swipe — because
 * an open sheet owns the input over it, and paging the song out from under one
 * reads as a bug in the sheet. Asking the DOM is what makes the answer cover
 * every modal there will be: a list of a page's own modals is a list that the
 * next modal is not on.
 *
 * It lives here rather than beside `Sheet` because a component file exports only
 * components — see CLAUDE.md — and the pair of attributes below is the contract
 * between the two. There are two modals now, the sheet and the phone's
 * navigation drawer, and `useModal` is what keeps them from being two copies of
 * it: the marking is *returned* rather than written by each of them, so the
 * drawer — which stays mounted so it can slide — cannot forget that its own
 * marking has to come and go with it. A move to `<dialog>` and `showModal()` is
 * then a change to this module and nothing else.
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
 * Escape, the scroll lock, focus, and the marking above — everything a modal
 * owes the page behind it.
 *
 * Deliberately **two effects with different keys**, and that is the whole of
 * why this is a hook rather than one. Every call site passes `onClose` as an
 * inline closure, so the first effect re-runs on any parent render while the
 * modal is *open* — harmless for a listener and a style, and ruinous for a
 * focus restore, which would fire from that cleanup and pull focus out of the
 * dialog and onto the trigger behind the backdrop. Renders like that are
 * ordinary: the profile page reopens its sheet while an upload is in flight,
 * and `AddToListSheet` re-renders its page on every list it toggles.
 *
 * `focus` is for a modal that stays mounted. One that unmounts takes focus with
 * it and needs nothing on the way up; one that does not has to be *sent* its
 * focus, or the reader is left outside a dialog they have to go looking for.
 * Focus is handed back to whatever opened it either way — an unmounted element
 * drops focus to `<body>`, which is no element at all, and a mounted one leaves
 * it inside a panel nobody can see any more. `focus` on an element that has
 * since left the document or gone disabled does nothing, which is right in both
 * cases.
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
    // `focus` is a ref, so it is the same object on every render and says
    // nothing about when this should run. `open` alone is the key — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return open ? { role: "dialog", "aria-modal": true } : {};
}
