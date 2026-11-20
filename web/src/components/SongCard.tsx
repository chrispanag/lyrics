import { memo } from "react";
import { ListPlus, SquarePlay } from "lucide-react";

import { Snippet } from "./Snippet";
import { cardChrome, cardHover, tagChrome } from "./cardStyles";
import { cn } from "@/lib/cn";
import { songByline } from "@/lib/credits";
import { songHref } from "@/lib/listContext";
import { listAddsLabel } from "@/lib/popularity";
import { Link } from "@/lib/navigation";
import type { Song } from "@/lib/types";

/**
 * Memoized: browse re-renders on every keystroke, and song objects from the
 * query cache have stable identity.
 *
 * `listId` (passed by list rows only) keeps `?list=` on the song's address.
 *
 * The subtitle and genre row keep their box when empty so cards stay level; the
 * snippet varies in height and is not reserved.
 */
export const SongCard = memo(function SongCard({ song, listId }: { song: Song; listId?: string }) {
  const credits = songByline(song);
  const saves = song.popularity.list_adds;

  return (
    <Link
      href={songHref(song, listId)}
      className={cn(cardChrome, cardHover, "block bg-surface p-4 active:bg-accent-subtle")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* h2: both pages that list cards (the catalog and a list) put them
              directly under the page's h1, and an h3 there skips a level. */}
          <h2 className="truncate font-semibold text-fg">{song.title}</h2>
          {/* Always rendered; `min-h-lh` gives an empty <p> its line box. */}
          <p className="mt-0.5 min-h-lh truncate text-sm text-fg-muted">{credits}</p>
        </div>
        {(saves > 0 || song.youtube_video_id) && (
          <div className="flex shrink-0 items-center gap-2">
            {saves > 0 && (
              // The number is the times it was placed in a list. Clicks and how
              // many people saved it stay off the card. Spoken in full; the
              // digits stay visible for someone scanning the row.
              <span className={cn(tagChrome, "inline-flex items-center gap-1 font-medium")}>
                <ListPlus aria-hidden className="size-3" />
                <span aria-hidden>{saves}</span>
                <span className="sr-only">{listAddsLabel(saves)}</span>
              </span>
            )}
            {song.youtube_video_id && (
              <SquarePlay
                role="img"
                aria-label="Has a video"
                className="size-5 shrink-0 text-fg-subtle"
              />
            )}
          </div>
        )}
      </div>

      {song.snippet && (
        <Snippet
          text={song.snippet}
          className="mt-2 line-clamp-2 text-sm leading-relaxed whitespace-pre-line text-fg-tertiary"
        />
      )}

      {/* Held open when empty by an invisible chip rather than a measured
          height. Its non-breaking space is load-bearing: an empty flex item is
          only its padding. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {song.genres.length > 0 ? (
          song.genres.map((genre) => (
            <span key={genre.id} className={tagChrome}>
              {genre.name}
            </span>
          ))
        ) : (
          <span aria-hidden className={cn(tagChrome, "invisible")}>
            {"\u00A0"}
          </span>
        )}
      </div>
    </Link>
  );
});
