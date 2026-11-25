import { MenuHeader } from "@/components/SearchHeader";

/*
 * The app bar carrying the menu button, for every shell screen without a
 * search box of its own: the way back to a collapsed column at a desk, and on
 * a phone only the room the notch takes (the bottom bar is a phone's
 * navigation). A layout, so a new screen gets it by position: a screen left
 * out has no way back to the column. The catalog, a list and the song page
 * sit outside this group, in `(reader)`, because their own headers carry the
 * button there (`SearchHeader`, `ToolbarHeader`).
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
