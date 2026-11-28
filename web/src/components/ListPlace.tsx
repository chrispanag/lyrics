import { BackButton } from "@/components/BackButton";
import { type ListPosition, positionLabel } from "@/lib/listContext";

/*
 * Where a song sits in the list it is read from, as a book's running head
 * says it ("Ρεμπέτικα · 2 of 3"). Apart from `ListSongNav`, so the shell's
 * bottom bar, which shows it too, does not load the song page's paging.
 */

/**
 * The list's name and the place in it: on the song's Back, and on the shrunk
 * bottom bar. The name gives way first. Both colors pass AA on the fills
 * they sit on (the bar's canvas, Back's hover), as `fg-muted` would not.
 */
export function ListPlace({ position }: { position: ListPosition }) {
  return (
    <>
      <span className="min-w-0 truncate text-fg-secondary">{position.listName}</span>
      <span className="shrink-0 text-fg-tertiary">·</span>
      <span className="shrink-0 tabular-nums text-fg-tertiary">{positionLabel(position)}</span>
    </>
  );
}

/**
 * The song's Back while it is read from a list: it shows the list's place,
 * and is still called Back ("Back to Ρεμπέτικα, 2 of 3"). It leads to the
 * list behind the song, or from a shared link to the one it names (`upHref`).
 */
export function BackToList({
  position,
  className,
}: {
  position: ListPosition;
  className?: string;
}) {
  return (
    <BackButton
      className={className}
      label={`Back to ${position.listName}, ${positionLabel(position)}`}
    >
      <ListPlace position={position} />
    </BackButton>
  );
}
