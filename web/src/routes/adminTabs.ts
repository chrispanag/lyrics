/**
 * The console's screens, in the order its tabs offer them.
 *
 * Its own module because both halves of the console need the list and neither
 * can own it: `App.tsx` opens the section on the first of these, and
 * `AdminPages` renders them as tabs and takes its heading from whichever one
 * matches the address. Written out in both places instead, a reorder leaves
 * `/admin` opening a screen that is no longer the first tab — the navigation's
 * single entry then leads somewhere the tab strip disagrees with, and both
 * halves look right on their own.
 *
 * Kept out of `AdminPages` for a second reason: importing it from `App.tsx`
 * would pull the console's module into the bundle every visitor downloads,
 * undoing the lazy split. And out of a component file for the reason the style
 * modules are — those export only components, which is what keeps fast refresh
 * working.
 */
// `as const` so this is a tuple rather than an array: the section has to open on
// *something*, and under `noUncheckedIndexedAccess` a plain array's first entry
// is possibly undefined, which would put a fallback path in the route tree — a
// second literal, and so the very disagreement this module exists to prevent.
export const ADMIN_TABS = [
  { to: "/admin/users", label: "Users" },
  { to: "/admin/genres", label: "Genres" },
] as const;
