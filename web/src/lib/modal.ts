import {
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * What a modal is, asked of the DOM so every modal is covered, and the hooks
 * that make one. Page gestures stand down while one is open.
 *
 * Every modal is a native `<dialog>` opened with `showModal()`, which the
 * browser makes modal: inert page, focus moved in and handed back, Escape.
 * `useDialog` drives `Sheet`'s; the navigation drawer drives its own, since it
 * closes by sliding away (see `MobileNavDrawer`), and shares only
 * `useHomeEndInside`.
 */

/** Whether a modal is currently open anywhere on the page. */
export function modalIsOpen(): boolean {
  // Asked per element rather than as `dialog:modal`: jsdom parses that selector
  // and never matches it, and the test stub can only answer through `matches`.
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    if (dialog.matches(":modal")) return true;
  }
  return false;
}

/**
 * Fields, which own their own keys: arrows move a caret, and Home and End pick
 * a `<select>`'s first and last option as well as moving one.
 */
export const FIELDS = "input, textarea, select, [contenteditable]";

/** Props for the `<dialog>` that `useDialog` drives. */
interface DialogProps {
  ref: RefObject<HTMLDialogElement | null>;
  onClose: (event: SyntheticEvent<HTMLDialogElement>) => void;
  onClick: (event: MouseEvent<HTMLDialogElement>) => void;
}

function scrollsY(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const { overflowY } = getComputedStyle(el);
  return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight;
}

/**
 * The scroller Home or End was meant for: the nearest one around `target`, or
 * else the dialog's first — focus on Close in the header, or on `<body>` after
 * a press on plain text, is in no scroller at all. Never the dialog itself,
 * whose single pixel of travel is only there to hold the page still.
 */
function scrollerFor(target: EventTarget | null, dialog: HTMLDialogElement): HTMLElement | null {
  if (target instanceof Element && dialog.contains(target)) {
    for (let el: Element | null = target; el && el !== dialog; el = el.parentElement) {
      if (scrollsY(el)) return el;
    }
  }
  for (const el of dialog.querySelectorAll("*")) {
    if (scrollsY(el)) return el;
  }
  return null;
}

/**
 * Keeps Home and End inside an open modal `<dialog>`. WebKit sends them to the
 * document wherever focus is, so the page behind jumps to an end; taken here
 * and given to the scroller they were meant for. On the document rather than
 * the dialog, because a press on plain text leaves focus on `<body>`, where a
 * key never passes through the dialog. A field keeps them: a caret, or a
 * `<select>`'s first and last option. Shared by `useDialog` and the drawer.
 */
export function useHomeEndInside(open: boolean, ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Home" && event.key !== "End") return;
      // Shift extends a selection, which is the reader's, not a scroll.
      if (event.defaultPrevented || event.shiftKey) return;
      if (event.target instanceof Element && event.target.closest(FIELDS)) return;
      event.preventDefault();
      const scroller = scrollerFor(event.target, dialog);
      scroller?.scrollTo({ top: event.key === "Home" ? 0 : scroller.scrollHeight });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, ref]);
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

  useHomeEndInside(open, ref);

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
  };
  return [props, open && shown];
}
