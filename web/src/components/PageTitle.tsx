import { SITE_NAME } from "@/lib/site";

/**
 * Sets the document title for the route that renders it.
 *
 * React 19 hoists the `<title>` into `<head>` and removes it on unmount. This
 * only wins `document.title` because app/layout.tsx exports no metadata
 * `title`; see "Head assets" in CLAUDE.md.
 *
 * `name` is optional so a page still fetching its record renders the bare
 * product name rather than "undefined — Songfolio".
 */
export function PageTitle({ name }: { name?: string | undefined }) {
  return <title>{name ? `${name} — ${SITE_NAME}` : SITE_NAME}</title>;
}
