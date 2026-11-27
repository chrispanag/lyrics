/*
 * Every shell screen without a header of its own. On a phone it keeps the
 * screen clear of the notch; from `md` up the rail is the navigation and the
 * screen starts at the top. A layout, so a new screen gets it by position. The
 * catalog, a list and the song page sit outside this group, in `(reader)`,
 * because their own headers keep the notch clear (`SearchHeader`,
 * `ToolbarHeader`).
 */
export default function PlainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden className="pt-safe md:hidden" />
      {children}
    </>
  );
}
