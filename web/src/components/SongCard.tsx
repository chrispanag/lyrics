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
 * One genre as the card shows it, named because the row below is held open by a
 * second one with nothing in it — and a reservation stated in different words
 * from the thing it reserves is no reservation at all.
 */
const genreChip =
  "rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400";

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
          {/* Always rendered: an empty <p> has no line box, so a song with
              nobody credited would sit a line shorter than the cards around it.
              `min-h-lh` holds the line open from the element's own line height
              rather than restating text-sm's — on an engine without the unit it
              is dropped, and the card is merely uneven again. Reserved because
              it is an empty slot — the same box with nothing in it. The snippet
              below is content of varying size, and still moves the card. */}
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

      {/* Here whether the song has genres or not, for the reason the subtitle
          is: an empty slot keeps its box, so a card's height does not depend on
          what the song happens to carry. What holds the empty row open is a
          chip made invisible, not a height measured off one — the box reserved
          is then a chip's own, and cannot drift from the padding and text size
          that produce it. The space inside it is load-bearing: a flex item with
          no content is its padding and nothing more. Chips wrapping to a second
          row are content of varying size and still move the card, as the
          snippet above does. */}
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
