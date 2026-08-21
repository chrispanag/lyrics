/*
 * Whether a modal is up, asked of the DOM rather than of a page.
 *
 * Two gestures have to ask this — the arrow keys and the paging swipe — because
 * an open sheet owns the input over it, and paging the song out from under one
 * reads as a bug in the sheet. Asking the DOM is what makes the answer cover
 * every sheet there will be: a list of a page's own sheets is a list that the
 * next sheet is not on.
 *
 * It lives here rather than beside `Sheet`, which is the only modal there is,
 * because a component file exports only components — see CLAUDE.md — and the
 * pair of attributes below is the contract between them. A sheet that stops
 * marking itself this way, `<dialog>` and `showModal()` being the obvious
 * migration, has to say so here.
 */
const OPEN_MODAL = '[role="dialog"][aria-modal="true"]';

/** Whether a modal is currently open anywhere on the page. */
export function modalIsOpen(): boolean {
  return document.querySelector(OPEN_MODAL) !== null;
}
