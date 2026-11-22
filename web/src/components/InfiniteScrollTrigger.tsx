"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Asks for more as the end of a list nears. Render it after the list only
 * while there is more to load and nothing is loading: it is remounted after
 * each page, and a fresh observer reports at once, so a screen tall enough to
 * show the whole page keeps loading until it is filled.
 *
 * The root is the list's own scroller when it has one — the catalog beside
 * the lyrics — and the viewport otherwise. The margin is then a screen of
 * that scroller, which is what "a screen ahead" means once the page itself
 * no longer scrolls.
 */
/** How long the column's width holds still before the scroller is looked for again. */
const SETTLE_MS = 100;

export function InfiniteScrollTrigger({ onLoadMore }: { onLoadMore: () => void }) {
  const target = useRef<HTMLDivElement>(null);
  // An event, so a new callback each render does not restart the observer.
  const load = useEffectEvent(onLoadMore);

  useEffect(() => {
    const element = target.current;
    if (!element) return;

    let observer: IntersectionObserver | null = null;
    let root: Element | null = null;
    let watching = false;

    const connect = () => {
      const next = scrollRoot(element);
      if (watching && next === root) return;
      watching = true;
      root = next;
      observer?.disconnect();
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) load();
        },
        // A screen ahead, so the next page is usually there before it is reached.
        { root, rootMargin: "100% 0px" },
      );
      observer.observe(element);
    };

    connect();
    // The content column's width is what decides whether the list scrolls
    // inside itself. Collapsing the navigation changes it without a remount,
    // over a transition that resizes the column every frame, so the walk waits
    // for the width to settle. A height change, such as a page loading, is not
    // a reason to look again.
    const box = element.closest("main") ?? document.documentElement;
    let width: number | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const watch = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width;
      if (next === undefined || next === width) return;
      // The first report is the size `connect` above already walked at.
      const first = width === undefined;
      width = next;
      if (first) return;
      clearTimeout(settle);
      settle = setTimeout(connect, SETTLE_MS);
    });
    watch.observe(box);
    return () => {
      clearTimeout(settle);
      observer?.disconnect();
      watch.disconnect();
    };
  }, []);

  return <div ref={target} aria-hidden className="h-px" />;
}

/** The nearest ancestor that scrolls, or none when the page itself does. */
function scrollRoot(element: HTMLElement): Element | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}
