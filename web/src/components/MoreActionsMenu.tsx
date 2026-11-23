"use client";

import {
  Children,
  type ComponentType,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Ellipsis } from "lucide-react";

import { Button } from "./ui";
import { cn } from "@/lib/cn";

/*
 * The "⋯" menu that holds a screen's rarer actions, Delete above all, so they
 * stay one deliberate step away from the reader's hand. A menu button in the
 * WAI-ARIA sense: one tab stop, opened by click, Enter, Space or ArrowDown, its
 * items walked with the arrow keys, Home and End.
 *
 * The panel is a `popover="manual"`, for the top layer: the reader panes clip
 * their overflow, and a panel in the flow would be cut off at the pane's edge.
 * Manual rather than `auto`, so that dismissal is this file's own, the same in
 * every engine and in the jsdom suite: an outside press, Escape, and focus
 * leaving (Tab) close it. It is placed by CSS anchor positioning (`.action-menu`
 * in index.css), or by `placeUnanchored` where that is missing.
 *
 * The panel is mounted only while open, so a closed menu has no items to find,
 * in the accessibility tree or in a spec.
 */

interface MenuContext {
  /** Closes the menu and hands focus back to the trigger, without a ring after a pointer. */
  close: (fromPointer: boolean) => void;
}

const Menu = createContext<MenuContext | null>(null);

/** The items the arrow keys can reach: every one but those disabled. */
function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
}

/** Whether this engine places the panel by its anchor; see `.action-menu`. */
function anchorsSupported(): boolean {
  return typeof CSS !== "undefined" && CSS.supports?.("position-area: block-end") === true;
}

/**
 * Below the trigger, its right edge on the trigger's, for an engine without
 * anchor positioning. Measured once on opening; the trigger sits at the end of
 * a bar, so the panel grows into the bar's width and never past the pane.
 */
function placeUnanchored(menu: HTMLElement, trigger: HTMLElement) {
  const rect = trigger.getBoundingClientRect();
  menu.style.top = `${rect.bottom}px`;
  menu.style.right = `${document.documentElement.clientWidth - rect.right}px`;
}

/**
 * Renders nothing when it holds no items, so each item is gated by its own
 * condition and no caller restates them all to decide whether to show the menu.
 */
export function MoreActionsMenu({
  disabled,
  children,
}: {
  /** The trigger's, for while nothing in the menu could act yet. */
  disabled?: boolean;
  /** `MenuItem`s, each present only for a reader who may use it. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Which item a keyboard open lands on. A pointer open lands nowhere: focus
  // stays on the trigger, and ArrowDown then enters, as in a native menu.
  const enterAt = useRef<"first" | "last" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const triggerId = `${id}-trigger`;
  const menuId = `${id}-menu`;
  // A dashed ident from the id, which may hold characters an ident cannot.
  const anchor = `--menu-${id.replace(/[^\w-]/g, "")}`;

  const show = (at: "first" | "last" | null) => {
    enterAt.current = at;
    setOpen(true);
  };

  const close = (fromPointer: boolean) => {
    // Focus first: hiding the panel with focus inside would drop it on <body>.
    trigger.current?.focus({ focusVisible: !fromPointer });
    setOpen(false);
  };

  useLayoutEffect(() => {
    const panel = menu.current;
    if (!open || !panel || !trigger.current) return;
    panel.showPopover();
    if (!anchorsSupported()) placeUnanchored(panel, trigger.current);
    const list = itemsOf(panel);
    const target = enterAt.current === "last" ? list.at(-1) : list[0];
    if (enterAt.current) target?.focus();
    enterAt.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      target instanceof Node &&
      !menu.current?.contains(target) &&
      !trigger.current?.contains(target);
    // On the press, not the click, as a native menu does; the trigger is left
    // to its own click, which toggles. Focus is not moved: it goes where the
    // press sends it.
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    // Tab, or anything else that takes focus out of the menu.
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    // On the document, so Escape also closes a menu opened by pointer, where
    // focus is still on the trigger.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // `close`, spelled out: from the keyboard, so the ring shows.
      trigger.current?.focus();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const onTriggerClick = (event: MouseEvent) => {
    if (open) {
      setOpen(false);
      return;
    }
    // A click with no pointer behind it is Enter or Space, which enter the menu.
    show(event.detail === 0 ? "first" : null);
  };

  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const at = event.key === "ArrowDown" ? "first" : "last";
    if (!open) show(at);
    else
      itemsOf(menu.current)
        .at(at === "first" ? 0 : -1)
        ?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const list = itemsOf(menu.current);
    if (list.length === 0) return;
    const current = list.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % list.length
        : event.key === "ArrowUp"
          ? (current - 1 + list.length) % list.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? list.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    list[next]?.focus();
  };

  if (Children.toArray(children).length === 0) return null;

  return (
    <Menu.Provider value={{ close }}>
      <Button
        ref={trigger}
        id={triggerId}
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        // Lit while open, so it is clear which control the menu belongs to.
        className={cn(open && "bg-muted text-fg")}
        style={{ anchorName: anchor }}
      >
        <Ellipsis aria-hidden className="size-4" />
      </Button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          popover="manual"
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "action-menu z-dropdown min-w-44 max-w-[calc(100vw-2rem)]",
            "rounded-control border border-line bg-surface p-1 text-fg shadow-popover",
          )}
          style={{ positionAnchor: anchor }}
        >
          {children}
        </div>
      )}
    </Menu.Provider>
  );
}

/**
 * One action in a `MoreActionsMenu`. Choosing it closes the menu, with focus
 * back on the trigger, before `onSelect` runs: a sheet it opens then records
 * the trigger as its opener and hands focus back there.
 */
export function MenuItem({
  icon: Icon,
  danger,
  disabled,
  onSelect,
  children,
}: {
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
  /** Destructive: drawn in the danger color. */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  const menu = useContext(Menu);
  if (!menu) throw new Error("MenuItem is used outside a MoreActionsMenu");
  return (
    <button
      type="button"
      role="menuitem"
      // Reached by the arrow keys, not by Tab: the menu is one tab stop.
      tabIndex={-1}
      disabled={disabled}
      onClick={(event) => {
        menu.close(event.detail !== 0);
        onSelect();
      }}
      className={cn(
        "flex h-11 w-full items-center gap-3 rounded-compact px-3 text-left text-sm font-medium",
        "transition-colors focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-60",
        danger
          ? "text-fg-danger hover:bg-danger-subtle focus:bg-danger-subtle"
          : "hover:bg-subtle focus:bg-subtle",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {children}
    </button>
  );
}
