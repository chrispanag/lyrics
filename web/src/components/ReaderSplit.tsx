"use client";

import { type ReactNode, useEffect, useRef } from "react";

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
    <div className="@3xl/app:flex @3xl/app:h-dvh @3xl/app:overflow-hidden">
      <section
        aria-label="Songs"
        className={cn(
          "@3xl/app:min-h-0 @3xl/app:w-80 @3xl/app:shrink-0 @3xl/app:overflow-y-auto @3xl/app:overscroll-y-contain @3xl/app:bg-surface @5xl/app:w-96",
          onSong && "@max-3xl/app:hidden",
        )}
      >
        {catalog}
      </section>
      <div
        ref={lyrics}
        className={cn(
          "@3xl/app:min-h-0 @3xl/app:min-w-0 @3xl/app:flex-1 @3xl/app:overflow-y-auto @3xl/app:overscroll-y-contain",
          !onSong && "@max-3xl/app:hidden",
        )}
      >
        {/* At least the pane tall, so the empty state can center in it and a
            song can grow past it. */}
        <div className="@3xl/app:flex @3xl/app:min-h-full @3xl/app:flex-col">{children}</div>
      </div>
    </div>
  );
}
