/**
 * The console's screens, in tab order. `/admin`'s page redirects to the first and
 * `AdminPages` renders them as tabs, so one list keeps the two agreeing. Its own
 * module so the redirect page, a server file, imports no client code.
 */
// `as const` makes the first entry non-optional under `noUncheckedIndexedAccess`.
export const ADMIN_TABS = [
  { to: "/admin/users", label: "Users" },
  { to: "/admin/genres", label: "Genres" },
] as const;
