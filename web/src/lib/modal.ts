import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * What a modal is, asked of the DOM so every modal is covered, and the two hooks
 * that make one. Page gestures stand down while one is open.
 *
 * There are two shapes until the drawer moves too: `useDialog` drives a native
 * `<dialog>` opened with `showModal()`, which the browser makes modal — inert
 * page, focus moved in and handed back, Escape — and `useModal` hand-rolls
 * that marking and Escape for the drawer, which is still a `<div>`.
 */
const MARKED_MODAL = '[role="dialog"][aria-modal="true"]';

/** Whether a modal is currently open anywhere on the page. */
export function modalIsOpen(): boolean {
  if (document.querySelector(MARKED_MODAL) !== null) return true;
  // Asked per element rather than as `dialog:modal`: jsdom parses that selector
  // and never matches it, and the test stub can only answer through `matches`.
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    if (dialog.matches(":modal")) return true;
  }
  return false;
}

/**
 * The `overflow: hidden` scroll lock on `<body>`, for the drawer only. A modal
 * `<dialog>` is held still by `.dialog-viewport` in `index.css` instead.
 */
function useScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
}

/** The marking `modalIsOpen` looks for, resolved for the current state. */
export interface ModalMarking {
  role?: "dialog";
  "aria-modal"?: true;
}

/**
 * Escape, the scroll lock, focus, and the marking above, for a modal that is
 * not a `<dialog>` — the navigation drawer, which stays mounted.
 *
 * **Two effects with different keys**: `onClose` is an inline closure at every
 * call site, so the first effect re-runs on any parent render, and a focus
 * restore in its cleanup would pull focus out of the open dialog.
 */
export function useModal({
  open,
  onClose,
  focus,
}: {
  open: boolean;
  onClose: () => void;
  /** Given focus while the modal is up. */
  focus: RefObject<HTMLElement | null>;
}): ModalMarking {
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // `focus` is a ref, so `open` is what actually re-runs this.
  useEffect(() => {
    if (!open) return;

    const opener = document.activeElement;
    focus.current?.focus();

    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open, focus]);

  return open ? { role: "dialog", "aria-modal": true } : {};
}

/** Props for the `<dialog>` that `useDialog` drives. */
interface DialogProps {
  ref: RefObject<HTMLDialogElement | null>;
  onClose: (event: SyntheticEvent<HTMLDialogElement>) => void;
  onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDialogElement>) => void;
}

function isTextEntry(target: EventTarget): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** The element between `from` and `dialog` that can scroll, if any. */
function scrollerWithin(from: EventTarget, dialog: HTMLDialogElement): HTMLElement | null {
  for (
    let el = from instanceof HTMLElement ? from : null;
    el && el !== dialog;
    el = el.parentElement
  ) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight)
      return el;
  }
  return null;
}

/**
 * Opens a `<dialog>` with `showModal()` while `open` holds, and reports every
 * close the browser makes on its own — Escape, the back gesture, a press on the
 * dimmed area — through `onClose`, so the prop stays the one authority. The
 * element is a `.dialog-viewport` around a `.dialog-track` holding a
 * `[data-dialog-dismiss]` layer and the panel (`index.css`), which is what
 * keeps the page behind it from scrolling.
 *
 * The dialog has to be mounted while closed for `close()` to be what ends it:
 * that is what hands focus back to the opener. Unmounting an open dialog
 * instead drops focus on `<body>`, which is why the layout cleanup closes it
 * first — it runs before React removes the element.
 *
 * Returns the props and whether the content may mount, which is only once the
 * dialog is open. React's `autoFocus` focuses from script during the commit, so
 * a field mounted alongside `showModal()` would be focused first and recorded
 * as the opener; mounted a render later, it lands in an open dialog.
 */
export function useDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): [DialogProps, boolean] {
  const ref = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState(false);
  // Whether the prop still wants the dialog open: a `close` event after the
  // prop has already said so is the echo of our own `close()`, not news.
  const wanted = useRef(false);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;

    wanted.current = true;
    dialog.showModal();
    setShown(true);

    return () => {
      wanted.current = false;
      setShown(false);
      if (dialog.open) dialog.close();
    };
  }, [open]);

  const props: DialogProps = {
    ref,
    // The event is a queued task, so it can also land after a reopen — Strict
    // Mode closes and reopens on mount — and an open dialog is not news either.
    onClose: (event) => {
      if (wanted.current && !event.currentTarget.open) onClose();
    },
    // Light dismiss. The dialog covers the viewport (`.dialog-viewport`), so
    // the browser never sees a press outside it; the dimmed area is the
    // `[data-dialog-dismiss]` element instead. A click's target is where press
    // and release have in common, so a selection drag that ends there does not
    // count. Closed on the `click`, not `pointerup`: iOS hit-tests the tap's
    // click after release, so a dialog gone by then lets it through to the page.
    onClick: (event) => {
      if (event.target instanceof Element && event.target.hasAttribute("data-dialog-dismiss")) {
        event.currentTarget.close();
      }
    },
    // WebKit sends Home and End to the document wherever focus is in the
    // dialog, so the page behind jumps to an end. Taken here and given to the
    // scroller they were meant for; a text field keeps them for its caret.
    onKeyDown: (event) => {
      if (event.key !== "Home" && event.key !== "End") return;
      if (event.defaultPrevented || isTextEntry(event.target)) return;
      event.preventDefault();
      const scroller = scrollerWithin(event.target, event.currentTarget);
      scroller?.scrollTo({ top: event.key === "Home" ? 0 : scroller.scrollHeight });
    },
  };
  return [props, open && shown];
}
