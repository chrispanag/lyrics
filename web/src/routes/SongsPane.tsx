"use client";

import { lazy, type ReactNode, Suspense } from "react";

import { ListSkeleton } from "@/components/ListBar";
import { listInView } from "@/lib/listContext";
import { usePathname, useSearchParams } from "@/lib/navigation";
import { BrowsePage } from "@/routes/BrowsePage";

// Most songs are read from the catalog, so a list's page, its sheets and its
// mutations load only once the address names a list.
const LazyListDetailPage = lazy(() =>
  import("@/routes/ListsPages").then((m) => ({ default: m.ListDetailPage })),
);

/**
 * The songs in the `@catalog` slot: the list the reader is in, or else the
 * catalog. Every page of the slot renders this, and its default too, so the
 * address alone picks the pane (`listInView`) whichever page last matched.
 *
 * `list` is the list's pane where the page already holds it: a list's own page
 * passes it in, so the server writes the list into the HTML rather than a
 * fallback. Left out, it loads on demand.
 */
export function SongsPane({ list }: { list?: ReactNode }) {
  if (!listInView(usePathname(), useSearchParams())) return <BrowsePage />;
  return (
    list ?? (
      <Suspense fallback={<ListSkeleton />}>
        <LazyListDetailPage />
      </Suspense>
    )
  );
}
