import { memo } from "react";
import { Link } from "react-router-dom";
import { Youtube } from "lucide-react";

import { Snippet } from "./Snippet";
import { cardChrome, cardHover } from "./cardStyles";
import { cn } from "@/lib/cn";
import { creditLine } from "@/lib/credits";
import { songHref } from "@/lib/listContext";
import type { Song } from "@/lib/types";

/**
 * Memoized because the browse page re-renders on every keystroke of the search
 * box, and each card otherwise re-runs creditLine (copy + sort + Set) and
 * parseSegments (a full scan of the snippet) for a `song` that has not changed.
 * Song objects come from the query cache, so their identity is stable.
 *
 * `listId` is passed by the rows of a list and by nothing else: it is what keeps
 * a reader inside the list they opened the song from, rather than dropping them
 * onto a song with no way on to the next one.
 */
export const SongCard = memo(function SongCard({
  song,
  listId,
}: {
  song: Song;
  listId?: string;
}) {
  const credits = creditLine(song.credits);

  return (
    <Link
      to={songHref(song.id, listId)}
      className={cn(
        cardChrome,
        cardHover,
        "block bg-white p-4 active:bg-brand-50 dark:bg-stone-900",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-stone-900 dark:text-stone-100">
            {song.title}
          </h3>
          {credits && (
            <p className="mt-0.5 truncate text-sm text-stone-500 dark:text-stone-400">{credits}</p>
          )}
        </div>
        {song.youtube_video_id && (
          <Youtube aria-label="Has a video" className="size-5 shrink-0 text-stone-400" />
        )}
      </div>

      {song.snippet && (
        <Snippet
          text={song.snippet}
          className="mt-2 line-clamp-2 text-sm leading-relaxed whitespace-pre-line text-stone-600 dark:text-stone-400"
        />
      )}

      {song.genres.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {song.genres.map((genre) => (
            <span
              key={genre.id}
              className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400"
            >
              {genre.name}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
});
