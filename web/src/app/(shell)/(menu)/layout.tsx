import { MenuHeader } from "@/components/SearchHeader";

/*
 * The app bar carrying the phone's hamburger, for every shell screen without a
 * search box of its own. A layout, so a new screen gets it by position: a
 * screen left out has no navigation on a phone, and in an installed window no
 * browser chrome to fall back on. The catalog, a list and the song page sit
 * outside this group, in `(reader)`, because their own headers carry the
 * hamburger there (`SearchHeader`, `ToolbarHeader`).
 * `src/appRoutes.test.tsx` walks every route asking each for one. See CLAUDE.md,
 * "Frontend".
 */
export default function MenuBarLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MenuHeader />
      {children}
    </>
  );
}
