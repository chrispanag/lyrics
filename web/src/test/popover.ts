/**
 * jsdom hides a `[popover]` with its UA stylesheet but has no `showPopover()`
 * or `hidePopover()`, so a popover can never be shown, nor its contents found
 * by role. These mark a shown popover, and an author rule, which beats the
 * UA's, displays it.
 *
 * Not modeled: the top layer, `:popover-open`, light dismiss and the `toggle`
 * events. `MoreActionsMenu`, the one popover, does its own dismissing.
 */

const OPEN = "data-test-popover-open";

export function installPopoverStub() {
  const style = document.createElement("style");
  style.textContent = `[popover][${OPEN}] { display: block; }`;
  document.head.append(style);

  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    this.setAttribute(OPEN, "");
  };
  HTMLElement.prototype.hidePopover = function hidePopover(this: HTMLElement) {
    this.removeAttribute(OPEN);
  };
}
