import type { ReactNode } from "react";

import { Sheet } from "@/components/ui";
import type { Song } from "@/lib/types";

/*
 * Fixed locale and zone, so the server and the browser format alike, and a
 * reader anywhere sees the month the song was added in the catalog's own terms.
 */
const tally = new Intl.NumberFormat("en-US");
const month = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** `pluralize` takes regular `-s` nouns only, and "person" is not one. */
function people(n: number): string {
  return n === 1 ? "1 person" : `${tally.format(n)} people`;
}

function times(n: number): string {
  return n === 1 ? "once" : `${tally.format(n)} times`;
}

/**
 * A song's tallies, out of the way of reading it: the cards carry none, so this
 * is where they are. Views are the song page's opens, each visitor counted once
 * (`useRecordSongClick`). `list_adds` counts every placement and never falls;
 * `list_users` is who has it in a list now.
 */
export function SongStatsSheet({
  song,
  open,
  onClose,
}: {
  song: Song;
  open: boolean;
  onClose: () => void;
}) {
  const { anonymous_clicks, authenticated_clicks, list_adds, list_users } = song.popularity;

  return (
    <Sheet open={open} onClose={onClose} title="Stats">
      <dl className="divide-y divide-line">
        <StatRow
          label="Views"
          detail={
            authenticated_clicks > 0
              ? `${tally.format(authenticated_clicks)} by signed-in readers`
              : undefined
          }
        >
          {tally.format(anonymous_clicks + authenticated_clicks)}
        </StatRow>
        <StatRow label="Added to a list">{times(list_adds)}</StatRow>
        <StatRow label="In lists of">{people(list_users)}</StatRow>
        <StatRow label="In the catalog since">{month.format(new Date(song.created_at))}</StatRow>
      </dl>
    </Sheet>
  );
}

function StatRow({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium">
        {children}
        {detail && <span className="block text-sm font-normal text-fg-muted">{detail}</span>}
      </dd>
    </div>
  );
}
