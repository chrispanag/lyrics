import type { ReactNode } from "react";

import { RemoveFromListButton } from "./RemoveFromListButton";
import { SongCard } from "./SongCard";
import type { Song } from "@/lib/types";

/**
 * One song as a list shows it: the card, the controls the viewer has earned,
 * and the chrome that lines them up.
 *
 * Every rendering of a list builds its rows here — the sortable one an owner
 * gets, and the plain one that serves readers, a list of one, and the wait for
 * the drag chunk. Built in each of them instead, they drift: the next affordance
 * reaches whichever file it was added to, and nothing fails to compile to say
 * the others went without. Removal was already that case.
 *
 * `handle` arrives already rendered rather than as a flag, which is what keeps
 * dnd-kit inside the lazily loaded list that owns it — nothing here imports it,
 * so a reader still downloads no drag library.
 */
export function SongRow({
  song,
  handle,
  onRemove,
  pendingRemoval,
}: {
  song: Song;
  handle?: ReactNode;
  /** Omitted for anyone who may not change the list, leaving the row read-only. */
  onRemove?: (songId: string) => void;
  /** The song whose removal is in flight, if any. */
  pendingRemoval?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {handle}
      <div className="min-w-0 flex-1">
        <SongCard song={song} />
      </div>
      {/* Opposite the handle rather than beside it: the two are the row's only
          controls, and a removal one slip away from the grip is a removal that
          happens by accident. */}
      {onRemove && (
        <RemoveFromListButton
          title={song.title}
          pending={pendingRemoval === song.id}
          onRemove={() => onRemove(song.id)}
        />
      )}
    </div>
  );
}
