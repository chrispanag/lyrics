import { memo } from "react";
import { Link } from "react-router-dom";
import { Youtube } from "lucide-react";

import { Snippet } from "./Snippet";
import { cardChrome, cardHover } from "./cardStyles";
import { cn } from "@/lib/cn";
import { songByline } from "@/lib/credits";
import { songHref } from "@/lib/listContext";
import type { Song } from "@/lib/types";

/** One genre as the card shows it, and the box that holds its row open without one. */
const genreChip =
  "rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400";

/**
 * Memoized because the browse page re-renders on every keystroke of the search
 * box, and each card otherwise re-runs songByline (copy + sort + Set) and
 * parseSegments (a full scan of the snippet) for a `song` that has not changed.
 * Song objects come from the query cache, so their identity is stable.
 *
 * `listId` is passed by the rows of a list and by nothing else: it is what keeps
 * a reader inside the list they opened the song from, rather than dropping them
 * onto a song with no way on to the next one.
 *
 * Two of the card's slots are reserved when the song leaves them empty — the
 * subtitle and the genre row — because a card shorter than its neighbors puts
 * every row under it out of step, and an empty slot can keep its box: it is the
 * same box with nothing in it. The snippet is the one that is not reserved. It
 * is two lines, or one, or (for a song whose lyrics are empty) none at all, so
 * there is no single box to hold open; cards in a search result are uneven by
 * that much, and only there. Each reservation below says how it is made.
 */
export const SongCard = memo(function SongCard({
  song,
  listId,
}: {
  song: Song;
  listId?: string;
}) {
  const credits = songByline(song);

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
          {/* Always rendered, since an empty <p> has no line box of its own.
              `min-h-lh` is that line height read off the element rather than
              restated from text-sm — on an engine without the unit it is
              dropped, and the card is merely uneven again. */}
          <p className="mt-0.5 min-h-lh truncate text-sm text-stone-500 dark:text-stone-400">
            {credits}
          </p>
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

      {/* Always rendered too, held open when empty by a chip made invisible
          rather than by a height measured off one: a chip is 1rem of line and
          0.25rem of padding, three coinciding values across two utilities, and
          a number standing in for them drifts from any of them in silence. The
          box reserved is a chip's own box, in the same words. The space inside
          it is load-bearing — a flex item with no content is its padding and
          nothing more. Chips that wrap to a second row still move the card,
          which is the snippet's case above rather than this one. */}
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
