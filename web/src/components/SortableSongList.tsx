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

import { rowControlChrome } from "./buttonStyles";
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
 */
export function SortableSongList({
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
        <ul className="space-y-3">
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
}

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
      className={isDragging ? "relative z-10 opacity-80" : undefined}
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
