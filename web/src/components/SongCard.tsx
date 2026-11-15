import { memo } from "react";
import { SquarePlay } from "lucide-react";

import { Snippet } from "./Snippet";
import { cardChrome, cardHover } from "./cardStyles";
import { cn } from "@/lib/cn";
import { songByline } from "@/lib/credits";
import { songHref } from "@/lib/listContext";
import { Link } from "@/lib/navigation";
import type { Song } from "@/lib/types";

/** One genre as the card shows it, and the box that holds its row open without one. */
const genreChip = "rounded-full bg-subtle px-2 py-0.5 text-xs text-fg-tertiary";

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
        {song.youtube_video_id && (
          <SquarePlay
            role="img"
            aria-label="Has a video"
            className="size-5 shrink-0 text-fg-subtle"
          />
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
            <span key={genre.id} className={genreChip}>
              {genre.name}
            </span>
          ))
        ) : (
          <span aria-hidden className={cn(genreChip, "invisible")}>
            {"\u00A0"}
          </span>
        )}
      </div>
    </Link>
  );
});
