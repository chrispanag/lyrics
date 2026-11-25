import { type RefObject, useEffect } from "react";

import { cn } from "@/lib/cn";
import { useChromeScroll } from "@/lib/scrollChrome";

/**
 * The chrome every sticky top bar shares: `StickyHeader`'s, and a song's tools
 * bar, which is one only on a phone (`phoneOnly`). The look is the
 * `sticky-bar` utility in index.css; `tucks` adds the slide out of the way
 * with the rest of the phone's chrome, which index.css draws from
 * `data-chrome-tucked` on <html> (`lib/scrollChrome`), below `md` only, and
 * never while the bar holds visible focus or an open menu: a Tab into it must
 * land on screen, and a menu must not lose its trigger (`chrome-tucked`).
 *
 * Two literal spellings rather than a prefix glued on, since Tailwind finds
 * its classes by reading the source.
 */
export function stickyBarClasses({
  phoneOnly = false,
  tucks = true,
}: {
  phoneOnly?: boolean;
  tucks?: boolean;
} = {}): string {
  return cn(
    phoneOnly ? "max-md:sticky-bar" : "sticky-bar",
    tucks && "max-md:chrome-tucked:-translate-y-full",
  );
}

/**
 * What a sticky top bar does besides its look (`stickyBarClasses`): takes part
 * in the phone's tucking (`useChromeScroll`), and publishes its height as
 * `--sticky-header-height` on <html>, which the root's `scroll-padding-top`
 * reads, so a control reached by Tab is scrolled clear of the bar rather than
 * to the viewport edge underneath it. Measured rather than written down: the
 * catalog's filter chips change the height, and a bar the layout has put away
 * is `display: none` and measures 0.
 *
 * A `phoneOnly` bar publishes only while it is sticky. Elsewhere it is an
 * ordinary row, or, for a song's tools beside the list, the pane's header,
 * which reads the variable to match the catalog's header; publishing its own
 * height there would size it by itself and overwrite the header it follows.
 */
export function useStickyBar(
  ref: RefObject<HTMLElement | null>,
  { phoneOnly = false }: { phoneOnly?: boolean } = {},
): void {
  useChromeScroll();

  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement.style;
    let published = "";
    // Only what this bar wrote: the list and the song each have a bar, and
    // the other may have published since.
    const withdraw = () => {
      if (published !== "" && root.getPropertyValue("--sticky-header-height") === published) {
        root.removeProperty("--sticky-header-height");
      }
      published = "";
    };
    const observer = new ResizeObserver(() => {
      // `offsetHeight` is the border box, so the safe-area padding counts too.
      // A bar the layout has put away measures 0. Publishing that would clear
      // the height of the bar that is actually showing, since only one is on
      // screen at a time.
      const height = bar.offsetHeight;
      if (height === 0) return;
      if (phoneOnly && getComputedStyle(bar).position !== "sticky") {
        withdraw();
        return;
      }
      published = `${height}px`;
      root.setProperty("--sticky-header-height", published);
    });
    // Border box here too, or a rotation that changes only the inset is missed.
    observer.observe(bar, { box: "border-box" });
    return () => {
      observer.disconnect();
      withdraw();
    };
  }, [ref, phoneOnly]);
}
