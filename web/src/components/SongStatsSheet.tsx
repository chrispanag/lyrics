import { Fact, FactList } from "@/components/FactList";
import { Sheet } from "@/components/ui";
import type { Song, SongPopularity } from "@/lib/types";

/* A fixed locale, so the server and the browser format alike. */
const tally = new Intl.NumberFormat("en-US");

/** `pluralize` takes regular `-s` nouns only, and "person" is not one. */
function people(n: number): string {
  return n === 1 ? "1 person" : `${tally.format(n)} people`;
}

function times(n: number): string {
  return n === 1 ? "once" : `${tally.format(n)} times`;
}

/**
 * A song's tallies, as rows, in the Stats sheet. Views are the song page's opens, each
 * visitor counted once (`useRecordSongClick`). `list_adds` counts every
 * placement and never falls; `list_users` is who has it in a list now.
 *
 * No "added on" date: `created_at` is when a row was inserted, which for the
 * imported catalog is the import, the same for nearly every song.
 */
export function SongStats({ popularity }: { popularity: SongPopularity }) {
  const { anonymous_clicks, authenticated_clicks, list_adds, list_users } = popularity;

  return (
    <FactList layout="justified">
      <Fact
        label="Views"
        detail={
          authenticated_clicks > 0
            ? `${tally.format(authenticated_clicks)} by signed-in readers`
            : undefined
        }
      >
        {tally.format(anonymous_clicks + authenticated_clicks)}
      </Fact>
      <Fact label="Added to a list">{times(list_adds)}</Fact>
      <Fact label="In lists of">{people(list_users)}</Fact>
    </FactList>
  );
}

/** The tallies out of the way of reading the song: the cards carry none. */
export function SongStatsSheet({
  song,
  open,
  onClose,
}: {
  song: Song;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Stats">
      <SongStats popularity={song.popularity} />
    </Sheet>
  );
}
