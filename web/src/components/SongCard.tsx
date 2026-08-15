import { memo } from "react";
import { Link } from "react-router-dom";
import { Youtube } from "lucide-react";

import { Snippet } from "./Snippet";
import { creditLine } from "@/lib/credits";
import type { Song } from "@/lib/types";

/**
 * Memoized because the browse page re-renders on every keystroke of the search
 * box, and each card otherwise re-runs creditLine (copy + sort + Set) and
 * parseSegments (a full scan of the snippet) for a `song` that has not changed.
 * Song objects come from the query cache, so their identity is stable.
 */
export const SongCard = memo(function SongCard({ song }: { song: Song }) {
  const credits = creditLine(song.credits);

  return (
    <Link
      to={`/songs/${song.id}`}
      className="block rounded-2xl border border-stone-200 bg-white p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40 active:bg-brand-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-brand-800 dark:hover:bg-stone-800/60"
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
