/*
 * Whether the navigation column is collapsed, and where that choice is kept.
 *
 * The column is part of the layout from `md` up. Collapsing it gives the width
 * back to the page, which is what lets the song list and the lyrics sit side by
 * side on a window that could not hold them beside the column. A phone has no
 * column — the bottom bar is its navigation — so the choice only changes a desk.
 *
 * An attribute on <html>, set before first paint by `NAV_COLLAPSED_BOOT_SCRIPT`,
 * and the rules in styles/index.css show and hide from it. The server's markup
 * is the same for every reader. Reading storage while rendering would make the
 * two disagree.
 */

const NAV_COLLAPSED_KEY = "lyrics:nav-collapsed";

/** On <html>. Present when the column is collapsed. index.css is keyed on it. */
export const NAV_COLLAPSED_ATTRIBUTE = "data-nav-collapsed";

/** The value stored when the reader has collapsed the column. Absence is open. */
const COLLAPSED = "1";

/**
 * The stored choice, or open when nothing is stored or storage is unavailable.
 *
 * The try makes this safe to call on a server, not to render with: the shell
 * reads it in a layout effect.
 */
export function storedNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === COLLAPSED;
  } catch {
    return false;
  }
}

/** Shows or hides the column, when the reader changes it. The first is the boot script's. */
export function applyNavCollapsed(collapsed: boolean): void {
  document.documentElement.toggleAttribute(NAV_COLLAPSED_ATTRIBUTE, collapsed);
}

/** Records the choice, for the boot script to read on the next load. */
export function storeNavCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(NAV_COLLAPSED_KEY, COLLAPSED);
    else localStorage.removeItem(NAV_COLLAPSED_KEY);
  } catch {
    // A choice that cannot be remembered still applies to the page that set it.
  }
}

/**
 * The same decision as `storedNavCollapsed()`, as source for the inline
 * <script> app/layout.tsx renders, so a collapsed column is collapsed from the
 * first paint. Nothing stored leaves the attribute off, which is open.
 *
 * Mirrors `storedNavCollapsed`; change both (`navCollapsed.test.ts` holds them
 * together). `let`, not `var`: an inline script runs in global scope.
 */
export const NAV_COLLAPSED_BOOT_SCRIPT =
  `try{` +
  `let c=localStorage.getItem(${JSON.stringify(NAV_COLLAPSED_KEY)});` +
  `if(c===${JSON.stringify(COLLAPSED)})` +
  `document.documentElement.setAttribute(${JSON.stringify(NAV_COLLAPSED_ATTRIBUTE)},"")` +
  `}catch(e){}`;
