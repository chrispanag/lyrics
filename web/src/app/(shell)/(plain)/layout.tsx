import { sheetChrome, sheetFrame } from "@/components/cardStyles";
import { cn } from "@/lib/cn";

/*
 * Every shell screen without a header of its own: your lists, the profile, the
 * admin console, the song editor. At a desk the screen is one sheet beside the
 * rail, as the reader's list and song are two (`sheetChrome`), at least a
 * window tall less the frame's inset and growing with the screen; the window
 * scrolls it. On a phone it keeps the screen clear of the notch, the room a
 * header would have taken.
 *
 * A layout, so a new screen gets it by position. The catalog, a list and the
 * song page sit outside this group, in `(reader)`, which sets out its own
 * sheets (`ReaderSplit`).
 */
export default function PlainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={sheetFrame}>
      <div aria-hidden className="pt-safe md:hidden" />
      <div className={cn("@3xl/app:min-h-[calc(100dvh_-_2_*_var(--reader-inset))]", sheetChrome)}>
        {children}
      </div>
    </div>
  );
}
