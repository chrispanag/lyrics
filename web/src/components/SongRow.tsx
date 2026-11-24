import type { ReactNode } from "react";

import { RemoveFromListButton } from "./RemoveFromListButton";
import { SongCard } from "./SongCard";
import type { Song } from "@/lib/types";

/**
 * One song as a list shows it: the card, the controls the viewer has earned,
 * and the chrome that lines them up.
 *
 * Every rendering of a list builds its rows here, so a per-row control added
 * here reaches all of them.
 *
 * `handle` arrives already rendered, which keeps dnd-kit inside the lazy chunk.
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
    <div className="flex items-center gap-2">
      {handle}
      <div className="min-w-0 flex-1">
        <SongCard song={song} listId={listId} />
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
