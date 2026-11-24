import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback } from "react";

import { queries } from "@/api/hooks";
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
 * A compact row, the title over one line of names and genres, so a phone shows
 * about ten. It draws no border: the list it sits in rules a line between rows
 * (`rowDividers` in cardStyles). The same row at every width, since beside a
 * song the list is a pane about as narrow as a phone.
 *
 * The names line keeps its box when empty so rows stay level; the snippet,
 * which only search results carry, varies in height and is not reserved.
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
  const genres = song.genres.map((genre) => genre.name).join(" · ");
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
        "block px-3 py-2.5 transition-colors hover:bg-accent-subtle active:bg-accent-subtle",
        // A bar as well as the fill, so the open song still stands apart from
        // the row under the pointer. Drawn over the padding, not as a border,
        // so it takes no width from the text.
        current &&
          "relative bg-accent-subtle before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-accent",
      )}
    >
      {/* h2: both pages that list cards (the catalog and a list) put them
          directly under the page's h1, and an h3 there skips a level. */}
      <h2 className="truncate font-semibold text-fg">{song.title}</h2>
      {/* Always rendered; `min-h-lh` gives an empty <p> its line box. The names
          give way first, so a long byline cannot push the genre out of sight,
          and the genre is capped so that it cannot push out the names.
          `fg-tertiary`, not `fg-muted`: the open song's row is a fill. */}
      <p className="flex min-h-lh gap-x-1 text-sm text-fg-tertiary">
        {credits && <span className="min-w-0 truncate">{credits}</span>}
        {genres && (
          <span className={cn("shrink-0 truncate", credits && "max-w-1/2")}>
            {/* The leading space is for the text a screen reader or a copy
                reads; on screen the line drops it and the gap stands in. */}
            {credits && " · "}
            {genres}
          </span>
        )}
      </p>

      {song.snippet && (
        <Snippet
          text={song.snippet}
          className="mt-1 line-clamp-2 text-sm leading-relaxed whitespace-pre-line text-fg-tertiary"
        />
      )}
    </Link>
  );
});
