"use client";

import type { ReactNode } from "react";

import { BackButton } from "./BackButton";
import { ReaderPane } from "./ReaderSplit";
import { ToolbarHeader } from "./SearchHeader";
import { Skeleton } from "./ui";

/*
 * A list's pane chrome, apart from the list itself: `SongsPane` shows it while
 * the list's own module loads, so it cannot live there.
 */

/**
 * The list's bar, with `actions` opposite the way back. Back is hidden beside
 * the lyrics, as it is on the song beside it: the sidebar is the way out.
 */
export function ListBar({ actions }: { actions?: ReactNode }) {
  return (
    <ToolbarHeader>
      <BackButton className="@3xl/app:hidden" />
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </ToolbarHeader>
  );
}

/** The list's pane while there is no list to show yet. Nameless in the tab. */
export function ListSkeleton() {
  return (
    <ReaderPane header={<ListBar />}>
      <div className="space-y-3">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-28 w-full" />
      </div>
    </ReaderPane>
  );
}
