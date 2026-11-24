"use client";

import type { ReactNode } from "react";

import { BackButton } from "./BackButton";
import { ReaderPane } from "./ReaderSplit";
import { ToolbarHeader } from "./SearchHeader";
import { songRows } from "./cardStyles";
import { SongCardSkeletons } from "./SongCard";
import { Skeleton } from "./ui";
import { useSongOpen } from "@/lib/catalogPane";

/*
 * A list's pane chrome, apart from the list itself: `SongsPane` shows it while
 * the list's own module loads, so it cannot live there.
 */

/**
 * The list's bar, with `actions` opposite the way back. Back is hidden beside
 * the lyrics once they share the screen, as it is on the song: the sidebar is
 * the way out. On the list's own page there are no lyrics, so it stays.
 */
export function ListBar({ actions }: { actions?: ReactNode }) {
  const songOpen = useSongOpen();
  return (
    <ToolbarHeader>
      <BackButton {...(songOpen && { className: "@3xl/app:hidden" })} />
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </ToolbarHeader>
  );
}

/** The list's pane while there is no list to show yet. Nameless in the tab. */
export function ListSkeleton() {
  return (
    <ReaderPane header={<ListBar />}>
      {/* The heading block's lines, the name and then the count, so the rows
          below do not move down when the list arrives. */}
      <div className="mb-6">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="mt-3 h-5 w-24" />
      </div>
      <div className={songRows}>
        <SongCardSkeletons count={1} />
      </div>
    </ReaderPane>
  );
}
