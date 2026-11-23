"use client";

import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { contentWidth } from "@/components/Page";
import { PageTitle } from "@/components/PageTitle";
import { CatalogPaneContext, SongOpenContext, useSongOpen } from "@/lib/catalogPane";
import { cn } from "@/lib/cn";
import { songRefFromPath } from "@/lib/listContext";
import { usePathname } from "@/lib/navigation";

/**
 * The catalog, or a list, on the left and the lyrics on the right, once the
 * content column can hold both — an inbox beside the message it has open.
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
 */
export function ReaderSplit({ catalog, children }: { catalog: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const onSong = songRefFromPath(pathname) !== null;
  const frame = useRef<HTMLDivElement>(null);
  // Whether the panes sit side by side, which decides if the catalog beside a
  // song is shown (`lib/catalogPane.ts`). False on the server and the first
  // render, so both render the same unloaded list; the layout effect measures
  // before the first paint.
  const [split, setSplit] = useState(false);
  // Latched: once the list has shown it keeps reading while hidden, so coming
  // back from a song does not refetch every page it had loaded.
  const shown = !onSong || split;
  const [seen, setSeen] = useState(shown);
  if (shown && !seen) setSeen(true);

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
        <CatalogPaneContext value={seen}>
          <SongOpenContext value={onSong}>{catalog}</SongOpenContext>
        </CatalogPaneContext>
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

/**
 * The frame of the pane `ReaderSplit` puts on the left, the catalog's or a
 * list's: its `header` above, and under it the pane's content. Beside the
 * lyrics it is a fixed column, so the header stays put and only the content
 * scrolls, its scrollbar starting under the header. Below that it is the page,
 * and the header sticks as the page scrolls.
 *
 * While no song is open the pane is the page, so it names the tab after
 * `title`, nameless while that is still loading. Beside a song the song does.
 */
export function ReaderPane({
  header,
  title,
  children,
}: {
  header: ReactNode;
  title?: string | undefined;
  children: ReactNode;
}) {
  const songOpen = useSongOpen();
  return (
    <div className="@3xl/app:flex @3xl/app:min-h-0 @3xl/app:flex-1 @3xl/app:flex-col">
      {!songOpen && <PageTitle name={title} />}
      {/* `contents` below `@3xl`: a box only as tall as the header would be
          the sticky header's whole scroll range, and it would scroll away. */}
      <div className="contents @3xl/app:block @3xl/app:shrink-0">{header}</div>
      <div className="@3xl/app:min-h-0 @3xl/app:flex-1 @3xl/app:overflow-y-auto @3xl/app:overscroll-y-contain">
        <div className={cn("mx-auto px-4 py-4", contentWidth)}>{children}</div>
      </div>
    </div>
  );
}

/**
 * The pane's heading: the page's h1 on its own, and an h2 beside a song, which
 * holds the page's h1 itself. The pane's cards are h2s either way.
 */
export function PaneHeading(props: ComponentPropsWithoutRef<"h1">) {
  const Heading = useSongOpen() ? "h2" : "h1";
  return <Heading {...props} />;
}
