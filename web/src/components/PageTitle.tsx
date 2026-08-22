/** Appended to every page's own name. */
const SUFFIX = "Songfolio";

/**
 * Sets the document title for the route that renders it.
 *
 * React 19 hoists a `<title>` rendered anywhere in the tree into `<head>`, so
 * this needs no effect, no ref and no library — and it unwinds on unmount,
 * which is what stops a title outliving the page that set it.
 *
 * Shared rather than inlined for the reason `Wordmark` is: the suffix is the
 * product name, and a rename that reaches one screen and misses another fails
 * silently, since a tab renders perfectly well carrying last year's name.
 *
 * `name` is optional because pages that fetch a record have a stretch with
 * nothing to be named after. Rendering the bare product name then is
 * deliberate — the alternative is a title that flashes "undefined — Songfolio"
 * on the way in, and a tab is one of the few places that is fully visible while
 * the page under it is still a skeleton.
 */
export function PageTitle({ name }: { name?: string }) {
  return <title>{name ? `${name} — ${SUFFIX}` : SUFFIX}</title>;
}
