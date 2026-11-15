/**
 * jsdom has `<dialog>` but no `showModal()` or `close()`, and parses `:modal`
 * without ever matching it. This is the part of a modal dialog the specs lean
 * on: the `open` attribute, `:modal` through `matches`, focus moved in and
 * handed back to the opener, Escape as a `cancel` then a `close`, and that
 * `close` event arriving a task later.
 *
 * Not modelled: the inert page, the top layer, and `closedby` — the pointer
 * fallback in lib/modal.ts is what runs here.
 */

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const openers = new Map<HTMLDialogElement, Element | null>();

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const dialog = [...openers.keys()].at(-1);
  if (!dialog) return;
  const cancel = new Event("cancel", { cancelable: true });
  if (dialog.dispatchEvent(cancel)) dialog.close();
}

export function installDialogStub() {
  const proto = HTMLDialogElement.prototype;
  const matches = Element.prototype.matches;

  proto.showModal = function showModal(this: HTMLDialogElement) {
    if (this.open) return;
    if (openers.size === 0) document.addEventListener("keydown", onKeyDown);
    openers.set(this, document.activeElement);
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  };

  proto.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    const opener = openers.get(this);
    openers.delete(this);
    if (openers.size === 0) document.removeEventListener("keydown", onKeyDown);
    this.removeAttribute("open");
    if (opener instanceof HTMLElement) opener.focus();
    // A queued task, as in a browser: it arrives after the commit that closed it.
    setTimeout(() => this.dispatchEvent(new Event("close")));
  };

  Object.defineProperty(proto, "matches", {
    configurable: true,
    value(this: HTMLDialogElement, selectors: string): boolean {
      if (selectors === ":modal") return openers.has(this);
      return matches.call(this, selectors);
    },
  });
}
