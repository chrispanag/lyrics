"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Asks for more as the end of a list nears the viewport. Render it after the
 * list only while there is more to load and nothing is loading: it is
 * remounted after each page, and a fresh observer reports at once, so a screen
 * tall enough to show the whole page keeps loading until it is filled.
 */
export function InfiniteScrollTrigger({ onLoadMore }: { onLoadMore: () => void }) {
  const target = useRef<HTMLDivElement>(null);
  // An event, so a new callback each render does not restart the observer.
  const load = useEffectEvent(onLoadMore);

  useEffect(() => {
    const element = target.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      },
      // A screen ahead, so the next page is usually there before it is reached.
      { rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={target} aria-hidden className="h-px" />;
}
