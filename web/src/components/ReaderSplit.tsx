"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import { songRefFromPath } from "@/lib/listContext";
import { usePathname } from "@/lib/navigation";

/**
 * The catalog on the left and the lyrics on the right, from `lg` up — an inbox
 * beside the message it has open.
 *
 * Below that, the address picks one screen and it fills the page: the same
 * list, or the same lyrics, so a phone is those two regions with one put
 * away. Which one is showing follows the address, in CSS, so the server and
 * the browser agree before either knows the width.
 */
export function ReaderSplit({ catalog, children }: { catalog: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const onSong = songRefFromPath(pathname) !== null;
  const lyrics = useRef<HTMLDivElement>(null);

  // The list keeps its place. The lyrics start at the top of each song. The
  // path is the trigger: the effect reads the pane, not the address.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger.
  useEffect(() => {
    lyrics.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div className="lg:flex lg:h-dvh lg:overflow-hidden">
      <section
        aria-label="Songs"
        className={cn(
          "lg:min-h-0 lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:overscroll-y-contain lg:border-r lg:border-line lg:bg-surface xl:w-96",
          onSong && "max-lg:hidden",
        )}
      >
        {catalog}
      </section>
      <div
        ref={lyrics}
        className={cn(
          "lg:min-h-0 lg:min-w-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-y-contain",
          !onSong && "max-lg:hidden",
        )}
      >
        {/* At least the pane tall, so the empty state can center in it and a
            song can grow past it. */}
        <div className="lg:flex lg:min-h-full lg:flex-col">{children}</div>
      </div>
    </div>
  );
}
