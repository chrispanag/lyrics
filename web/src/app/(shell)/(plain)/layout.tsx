import { sheetChrome } from "@/components/cardStyles";
import { cn } from "@/lib/cn";

/*
 * Every shell screen without a header of its own: your lists, the profile, the
 * admin console, the song editor. At a desk the screen is one sheet beside the
 * rail, as the reader's list and song are two (`sheetChrome`), at least a
 * window tall and growing with the screen; the window scrolls it. On a phone it
 * keeps the screen clear of the notch, the room a header would have taken.
 *
 * A layout, so a new screen gets it by position. The catalog, a list and the
 * song page sit outside this group, in `(reader)`, which sets out its own
 * sheets (`ReaderSplit`).
 *
 * `plain-frame`: index.css drops the shell's bottom padding around it, as the
 * frame's own inset takes its place.
 */
export default function PlainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="plain-frame @3xl/app:flex @3xl/app:min-h-dvh @3xl/app:flex-col @3xl/app:py-(--reader-inset) @3xl/app:pr-(--reader-inset)">
      <div aria-hidden className="pt-safe md:hidden" />
      <div className={cn("@3xl/app:flex-1", sheetChrome)}>{children}</div>
    </div>
  );
}
