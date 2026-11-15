/**
 * The console's screens, in tab order. `App.tsx` opens `/admin` on the first and
 * `AdminPages` renders them as tabs, so one list keeps the two agreeing. Not in
 * `AdminPages`: importing that from `App.tsx` would defeat its lazy chunk.
 */
// `as const` makes the first entry non-optional under `noUncheckedIndexedAccess`.
export const ADMIN_TABS = [
  { to: "/admin/users", label: "Users" },
  { to: "/admin/genres", label: "Genres" },
] as const;
