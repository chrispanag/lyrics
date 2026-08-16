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

import { SongCard } from "./SongCard";
import { verticalWithinList } from "@/lib/dragBounds";
import type { Song } from "@/lib/types";

/**
 * A list's songs, reorderable by its owner.
 *
 * Loaded on demand (see ListDetailPage) so that everyone who cannot reorder —
 * every guest, every reader of a shared list — is not made to download a drag
 * library to read one.
 */
export function SortableSongList({
  songs,
  onReorder,
}: {
  songs: Song[];
  onReorder: (songIds: string[]) => void;
}) {
  const sensors = useSensors(
    // A few pixels of movement before a drag begins, so pressing the handle and
    // releasing still reads as a click rather than a zero-distance drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Touch needs a hold instead: an immediate drag would swallow the flick
    // that scrolls the page. The tolerance lets a finger wobble during the hold
    // without cancelling it.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    // Dropped outside the list, or back where it started: no order to save.
    if (!over || active.id === over.id) return;

    const ids = songs.map((song) => song.id);
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
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
            <SortableRow key={song.id} song={song} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ song }: { song: Song }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: song.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <div className="flex items-center gap-2">
        {/* The handle is the only thing that starts a drag. Were the whole row
            draggable, a phone would have no gesture left for scrolling the
            page — and `touch-none` is what hands this element's gestures to the
            drag library instead of the browser's scrolling, without which
            dragging on touch silently does nothing at all. */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Reorder ${song.title}`}
          className="shrink-0 cursor-grab touch-none rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-600 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none active:cursor-grabbing dark:hover:bg-stone-800 dark:hover:text-stone-300"
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <SongCard song={song} />
        </div>
      </div>
    </li>
  );
}
