import { SITE_NAME } from "@/lib/site";

/**
 * Sets the document title for the route that renders it.
 *
 * React 19 hoists a `<title>` rendered anywhere in the tree into `<head>`, so
 * this needs no effect, no ref and no library — and it unwinds on unmount,
 * which is what stops a title outliving the page that set it.
 *
 * What makes that work is *where* it hoists to, and it is the reason
 * app/layout.tsx deliberately exports no `title` in its metadata. React puts a
 * hoisted title ahead of a title it does not manage — index.html's static one,
 * under Vite — and `document.title` is the first title element in the head, so
 * this one was read and the static one stayed a fallback. A Next `metadata`
 * title is not such a node: React renders it too, from the layout, which is
 * above every route here — so it sorts *first*, wins the read, and is written
 * again when the streamed metadata boundary resolves after hydration. Adding
 * one back therefore pins every tab in the app to the bare product name, and
 * only in a browser: these specs assert `document.title` in jsdom, where there
 * is no competing title to lose to. Verified against a real document, both
 * ways round.
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
  return <title>{name ? `${name} — ${SITE_NAME}` : SITE_NAME}</title>;
}
