import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { memo } from "react";

import { rowControlChrome } from "./buttonStyles";
import { songRows } from "./cardStyles";
import { SongRow } from "./SongRow";
import { cn } from "@/lib/cn";
import { verticalWithinList } from "@/lib/dragBounds";
import type { Song } from "@/lib/types";

/**
 * A list's songs, reorderable and removable by its owner.
 *
 * Loaded on demand (see ListDetailPage) so readers never download dnd-kit.
 *
 * `onRemove` is required: only owners see this list, and a forgotten one would
 * silently render rows that cannot be removed.
 *
 * Memoized: beside a song the list re-renders on every step through it, and
 * only the cards themselves follow the open song. The callbacks must be stable
 * for this to hold.
 */
export const SortableSongList = memo(function SortableSongList({
  songs,
  listId,
  onReorder,
  onRemove,
  pendingRemoval,
}: {
  songs: Song[];
  /** The list being shown, which its rows carry into the songs they open. */
  listId: string;
  onReorder: (songIds: string[]) => void;
  onRemove: (songId: string) => void;
  /** The song whose removal is in flight, if any. */
  pendingRemoval?: string | undefined;
}) {
  const sensors = useSensors(
    // So a press and release on the handle stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Touch needs a hold, or a drag would swallow the flick that scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    // Dropped outside the list, or back where it started: no order to save.
    if (!over || active.id === over.id) return;

    const ids = songs.map((song) => song.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    // A refetch mid-drag can remove a row; arrayMove would read -1 as "last".
    if (from < 0 || to < 0) return;

    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalWithinList]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={songs.map((song) => song.id)} strategy={verticalListSortingStrategy}>
        <ul className={songRows}>
          {songs.map((song) => (
            <SortableRow
              key={song.id}
              song={song}
              listId={listId}
              onRemove={onRemove}
              pendingRemoval={pendingRemoval}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
});

function SortableRow({
  song,
  listId,
  onRemove,
  pendingRemoval,
}: {
  song: Song;
  listId: string;
  onRemove: (songId: string) => void;
  pendingRemoval?: string | undefined;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: song.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // Lifted while dragged, and opaque: a row has no background of its own,
      // and would show the row it passes over through its text. Filled with
      // what the list sits on, the page below `@3xl` and the pane's surface
      // beside a song (ReaderSplit), so only the shadow sets it apart.
      className={
        isDragging ? "relative z-raised bg-canvas shadow-popover @3xl/app:bg-surface" : undefined
      }
    >
      <SongRow
        song={song}
        listId={listId}
        onRemove={onRemove}
        pendingRemoval={pendingRemoval}
        handle={
          /* The only drag activator, so the row still scrolls on a phone;
             without `touch-none`, touch dragging silently does nothing. */
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label={`Reorder ${song.title}`}
            className={cn(
              rowControlChrome,
              "cursor-grab touch-none hover:bg-subtle hover:text-fg-secondary focus-visible:ring-focus active:cursor-grabbing",
            )}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden className="size-5" />
          </button>
        }
      />
    </li>
  );
}
