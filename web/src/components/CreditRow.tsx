import type { ReactNode } from "react";

/**
 * One labelled row of a song's credits, inside the header's `<dl>`.
 *
 * Shared by `SongHeader` and the server's `SongPreview`, whose geometry has to
 * match it to the pixel. The value is children rather than a list of people:
 * the app links names through the router, the preview with plain anchors, and
 * the year is no names at all.
 */
export function CreditRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
