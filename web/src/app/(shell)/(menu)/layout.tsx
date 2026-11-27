/*
 * The room the notch takes on a phone, for every shell screen without a
 * header of its own; the bar that sat here used to keep it clear with its
 * safe-area padding. From `md` up the rail is the navigation, and these
 * screens start at the top. A layout, so a new screen gets it by position.
 * The catalog, a list and the song page sit outside this group, in
 * `(reader)`, because their own headers keep the notch clear there
 * (`SearchHeader`, `ToolbarHeader`).
 */
export default function MenuBarLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden className="pt-safe md:hidden" />
      {children}
    </>
  );
}
