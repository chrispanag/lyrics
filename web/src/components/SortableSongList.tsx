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
 * Loaded on demand (see ListDetailPage) so that everyone who cannot reorder —
 * every guest, every reader of a shared list — is not made to download a drag
 * library to read one.
 *
 * `onRemove` is required rather than optional because only an owner is ever
 * shown this list, and an owner always gets both affordances: made optional, a
 * call site that forgets it renders rows that cannot be removed and says
 * nothing about it. `SongRow`, which serves readers too, has to ask.
 */
export function SortableSongList({
  songs,
  onReorder,
  onRemove,
  pendingRemoval,
}: {
  songs: Song[];
  onReorder: (songIds: string[]) => void;
  onRemove: (songId: string) => void;
  /** The song whose removal is in flight, if any. */
  pendingRemoval?: string;
}) {
  const sensors = useSensors(
    // A few pixels of movement before a drag begins, so pressing the handle and
    // releasing still reads as a click rather than a zero-distance drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Touch needs a hold instead: an immediate drag would swallow the flick
    // that scrolls the page. The tolerance lets a finger wobble during the hold
    // without canceling it.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    // Dropped outside the list, or back where it started: no order to save.
    if (!over || active.id === over.id) return;

    const ids = songs.map((song) => song.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    // A refetch landing between the lift and the drop can take a row out from
    // under the drag. arrayMove reads the resulting -1 as "the last one" and
    // would save an order nobody asked for, so nothing is saved instead.
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
  onRemove,
  pendingRemoval,
}: {
  song: Song;
  onRemove: (songId: string) => void;
  pendingRemoval?: string;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: song.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <SongRow
        song={song}
        onRemove={onRemove}
        pendingRemoval={pendingRemoval}
        handle={
          /* The handle is the only thing that starts a drag. Were the whole row
             draggable, a phone would have no gesture left for scrolling the
             page — and `touch-none` is what hands this element's gestures to
             the drag library instead of the browser's scrolling, without which
             dragging on touch silently does nothing at all. */
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label={`Reorder ${song.title}`}
            className={cn(
              rowControlChrome,
              "cursor-grab touch-none hover:bg-stone-100 hover:text-stone-600 focus-visible:ring-brand-500 active:cursor-grabbing dark:hover:bg-stone-800 dark:hover:text-stone-300",
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
