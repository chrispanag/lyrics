import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback } from "react";
import { ListPlus, SquarePlay } from "lucide-react";

import { queries } from "@/api/hooks";
import { Snippet } from "./Snippet";
import { cardChrome, cardHover, tagChrome } from "./cardStyles";
import { cn } from "@/lib/cn";
import { songByline } from "@/lib/credits";
import { songHref, songMatchesRef, songRefFromPath } from "@/lib/listContext";
import { listAddsLabel } from "@/lib/popularity";
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
  const saves = song.popularity.list_adds;
  // Null when there is nothing to explain: a zero is not a badge.
  const savesLabel = saves > 0 ? listAddsLabel(saves) : null;
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
            {savesLabel && (
              // The number is the times it was placed in a list. Clicks and how
              // many people saved it stay off the card. The digits stay visible
              // for scanning; the words are spoken, and repeated under the pointer.
              <span className="group/saves relative inline-flex">
                <span className={cn(tagChrome, "inline-flex items-center gap-1 font-medium")}>
                  <ListPlus aria-hidden className="size-3" />
                  <span aria-hidden>{saves}</span>
                  <span className="sr-only">{savesLabel}</span>
                </span>
                {/* Hidden from assistive tech: the same words are already in the
                    link's name. Above the badge, so the byline under it stays
                    readable. The padding is the bridge, so the tip stays up
                    while the pointer crosses onto it. */}
                <span
                  aria-hidden
                  className="invisible absolute right-0 bottom-full z-dropdown pb-1 group-hover/saves:visible"
                >
                  <span className="block whitespace-nowrap rounded-control bg-inverse px-2 py-1 text-xs font-medium text-fg-inverse shadow-popover">
                    {savesLabel}
                  </span>
                </span>
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
