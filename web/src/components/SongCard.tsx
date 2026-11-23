import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback } from "react";

import { queries } from "@/api/hooks";
import { Snippet } from "./Snippet";
import { cardChrome, cardHover, tagChrome } from "./cardStyles";
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
 * The subtitle and genre row keep their box when empty so cards stay level; the
 * snippet varies in height and is not reserved.
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
        cardChrome,
        cardHover,
        "block bg-surface p-4 active:bg-accent-subtle",
        current && "border-line-accent bg-accent-subtle",
      )}
    >
      {/* h2: both pages that list cards (the catalog and a list) put them
          directly under the page's h1, and an h3 there skips a level. */}
      <h2 className="truncate font-semibold text-fg">{song.title}</h2>
      {/* Always rendered; `min-h-lh` gives an empty <p> its line box. */}
      <p className="mt-0.5 min-h-lh truncate text-sm text-fg-muted">{credits}</p>

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
