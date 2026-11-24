import type { ReactNode } from "react";

import { RemoveFromListButton } from "./RemoveFromListButton";
import { SongCard } from "./SongCard";
import { cn } from "@/lib/cn";
import type { Song } from "@/lib/types";

/**
 * One song as a list shows it: the card, the controls the viewer has earned,
 * and the chrome that lines them up.
 *
 * Every rendering of a list builds its rows here, so a per-row control added
 * here reaches all of them.
 *
 * `handle` arrives already rendered, which keeps dnd-kit inside the lazy chunk.
 *
 * The row, not the card, takes the hover and the open song's fill and bar, so
 * they span the handle and the remove button and the bar sits at the row's
 * edge rather than between the handle and the title. The card says which song
 * is open by its `aria-current`, which the row reads with `has-`.
 */
export function SongRow({
  song,
  listId,
  handle,
  onRemove,
  pendingRemoval,
}: {
  song: Song;
  /** The list these rows belong to, so opening a song keeps the reader in it. */
  listId: string;
  handle?: ReactNode;
  /** Omitted for anyone who may not change the list, leaving the row read-only. */
  onRemove?: ((songId: string) => void) | undefined;
  /** The song whose removal is in flight, if any. */
  pendingRemoval?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-2 transition-colors hover:bg-accent-subtle active:bg-accent-subtle",
        // SongCard's own mark, moved out to the row; keep the two alike. The
        // bar lets clicks through to the handle it is drawn over.
        "has-[[aria-current=page]]:bg-accent-subtle has-[[aria-current=page]]:before:pointer-events-none has-[[aria-current=page]]:before:absolute has-[[aria-current=page]]:before:inset-y-0 has-[[aria-current=page]]:before:left-0 has-[[aria-current=page]]:before:w-1 has-[[aria-current=page]]:before:bg-accent",
      )}
    >
      {handle}
      <div className="min-w-0 flex-1">
        <SongCard song={song} listId={listId} inRow />
      </div>
      {/* Opposite the handle, so a slip off the grip cannot remove the song. */}
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
