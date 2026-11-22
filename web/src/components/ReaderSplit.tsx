"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { CatalogPaneContext } from "@/lib/catalogPane";
import { cn } from "@/lib/cn";
import { songRefFromPath } from "@/lib/listContext";
import { usePathname } from "@/lib/navigation";

/**
 * The catalog on the left and the lyrics on the right, once the content column
 * can hold both — an inbox beside the message it has open.
 *
 * The column is what is left after the navigation. `@3xl` is 48rem, Tailwind's
 * `md`: with the column collapsed that is the window from `md` up, and with it
 * open (15rem) it is a window just under `lg`. Below that, the address picks
 * one screen and it fills the page. Which one is showing follows the address,
 * in CSS, so the server and the browser agree before either knows the width.
 *
 * `@5xl` (64rem) is the column an `xl` window leaves beside the open navigation,
 * where the list widens.
 *
 * Neither pane scrolls as a whole. The search and the song's tools stay put,
 * and each scrollbar belongs to the list or the lyrics under that bar. The
 * list keeps its place because its scroller lives in the catalog slot, which
 * stays mounted. A song starts at the top of its own lyrics.
 *
 * The frame is one viewport tall. A fractional device pixel makes that a pixel
 * taller than the window, which paints a scrollbar down the screen, through
 * both headers. While the panes are up the window does not scroll
 * (`html.reader-panes` in index.css).
 *
 * The catalog is hidden beside a song until the panes split, and the list
 * reads nothing while it is (`lib/catalogPane.ts`).
 */
export function ReaderSplit({ catalog, children }: { catalog: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const onSong = songRefFromPath(pathname) !== null;
  const frame = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(false);

  useLayoutEffect(() => {
    const frameEl = frame.current;
    const root = document.documentElement;
    if (!frameEl) return;
    // The content column. Its width is what the `@3xl/app` queries answer.
    const column = frameEl.closest("main") ?? frameEl.parentElement;
    const apply = () => {
      const panes = getComputedStyle(frameEl).overflowY === "hidden";
      root.classList.toggle("reader-panes", panes);
      setSplit(panes);
    };
    apply();
    const observer = new ResizeObserver(apply);
    if (column) observer.observe(column);
    return () => {
      observer.disconnect();
      root.classList.remove("reader-panes");
    };
  }, []);

  return (
    <div
      ref={frame}
      // `reader-frame`: index.css drops the shell's bottom padding around it.
      className="reader-frame @3xl/app:flex @3xl/app:h-dvh @3xl/app:overflow-hidden"
    >
      {/* The line is the edge between the search and the lyrics. Both header
          bands are the page color, so the list's surface alone does not draw it. */}
      <section
        aria-label="Songs"
        className={cn(
          "@3xl/app:flex @3xl/app:min-h-0 @3xl/app:w-80 @3xl/app:shrink-0 @3xl/app:flex-col @3xl/app:overflow-hidden @3xl/app:border-r @3xl/app:border-line @3xl/app:bg-surface @5xl/app:w-96",
          onSong && "@max-3xl/app:hidden",
        )}
      >
        <CatalogPaneContext value={!onSong || split}>{catalog}</CatalogPaneContext>
      </section>
      <div
        className={cn(
          // A column the song fills, so the empty state can center in it and
          // the lyrics can scroll under the tools.
          "@3xl/app:flex @3xl/app:min-h-0 @3xl/app:min-w-0 @3xl/app:flex-1 @3xl/app:flex-col @3xl/app:overflow-hidden",
          !onSong && "@max-3xl/app:hidden",
        )}
      >
        {children}
      </div>
    </div>
  );
}
