import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback } from "react";

import { queries } from "@/api/hooks";
import { GenreTag } from "./GenreTag";
import { Snippet } from "./Snippet";
import { cn } from "@/lib/cn";
import { songByline } from "@/lib/credits";
import { songHref, songMatchesRef, songRefFromPath } from "@/lib/listContext";
import { Link, usePathname, useRouter } from "@/lib/navigation";
import { useIntentPrefetch } from "@/lib/useIntentPrefetch";
import type { Song } from "@/lib/types";

/**
 * Memoized: browse re-renders on every keystroke, and song objects from the
 * query cache have stable identity.
 *
 * `listId` (passed by list rows only) keeps `?list=` on the song's address.
 *
 * A row of a song list rather than a card: no border and no box until the
 * pointer or the open song gives it a fill. Its height follows its content, so
 * a song with nobody credited and no genres is a title and a year. Separated
 * from its neighbors by spacing alone, which the list sets.
 */
export const SongCard = memo(function SongCard({
  song,
  listId,
  search,
}: {
  song: Song;
  listId?: string;
  /** Catalog filters to keep on the song's address, as a query string. */
  search?: string;
}) {
  const credits = songByline(song);
  const open = songRefFromPath(usePathname());
  const current = open !== null && songMatchesRef(song, open);

  // Both halves of the step: the page, which the router otherwise fetches only
  // on the click and holds the old song until it lands, and the song itself,
  // keyed by the slug the page's `useSong` reads it by. The song already open
  // has nothing left to load.
  const queryClient = useQueryClient();
  const router = useRouter();
  const slug = song.slug;
  const href = songHref(song, listId, search);
  const prefetch = useCallback(() => {
    if (current) return;
    router.prefetch(href);
    void queryClient.prefetchQuery(queries.song(slug));
  }, [queryClient, router, href, slug, current]);
  const intent = useIntentPrefetch(prefetch);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      {...intent}
      className={cn(
        "group flex items-baseline gap-3 rounded-control px-3 py-2 transition-colors active:bg-accent-subtle",
        current ? "bg-accent-subtle" : "hover:bg-subtle",
      )}
    >
      <div className="min-w-0 flex-1">
        {/* h2: both pages that list songs (the catalog and a list) put them
            directly under the page's h1, and an h3 there skips a level. */}
        <h2 className="truncate font-semibold text-fg">{song.title}</h2>
        {/* fg-tertiary rather than fg-muted: under the pointer and on the open
            song the row is a fill, where fg-muted is under 4.5:1. */}
        {credits && <p className="truncate text-sm text-fg-tertiary">{credits}</p>}

        {song.snippet && (
          <Snippet
            text={song.snippet}
            className="mt-1 line-clamp-2 text-sm leading-relaxed whitespace-pre-line text-fg-tertiary"
          />
        )}

        {/* A chip is drawn on `subtle`, the row's own fill under the pointer,
            so there the chips step up a shade to keep their shape. */}
        {song.genres.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 group-hover:*:bg-muted">
            {song.genres.map((genre) => (
              <GenreTag key={genre.id} genre={genre} />
            ))}
          </div>
        )}
      </div>

      {/* A column of its own, as wide with a year as without, so years line
          up down the list and every title has the same room. On the title's
          baseline: `items-baseline` takes the left column's first line. */}
      <span className="w-[4ch] shrink-0 text-right text-sm tabular-nums text-fg-tertiary">
        {song.release_year ?? ""}
      </span>
    </Link>
  );
});
