import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback } from "react";

import { queries } from "@/api/hooks";
import { Snippet } from "./Snippet";
import { Skeleton } from "./ui";
import { cn } from "@/lib/cn";
import { songByline } from "@/lib/credits";
import { songHref, songMatchesRef, songRefFromPath } from "@/lib/listContext";
import { Link, usePathname, useRouter } from "@/lib/navigation";
import { useIntentPrefetch } from "@/lib/useIntentPrefetch";
import type { Song } from "@/lib/types";

/** A row's box and lines, shared with its skeleton so the two are the same height. */
const songRowBox = "px-3 py-2.5";
const songRowTitle = "truncate font-semibold text-fg";
const songRowLine = "min-h-lh truncate text-sm text-fg-tertiary";

/**
 * Memoized: browse re-renders on every keystroke, and song objects from the
 * query cache have stable identity.
 *
 * `listId` and `inRow` (passed by list rows only) keep `?list=` on the song's
 * address, and leave the hover and the open song's mark to the row, which
 * paints them across its handle and remove button too.
 *
 * A compact row, the title over one line of genres and names, so a phone shows
 * about ten. It draws no border: the box it sits in rules a line between rows
 * (`songRows` in cardStyles). The same row at every width, since beside a song
 * the list is a pane about as narrow as a phone.
 *
 * The names line keeps its box when empty so rows stay level; the snippet,
 * which only search results carry, varies in height and is not reserved.
 */
export const SongCard = memo(function SongCard({
  song,
  listId,
  inRow = false,
  search,
}: {
  song: Song;
  listId?: string;
  inRow?: boolean;
  /** Catalog filters to keep on the song's address, as a query string. */
  search?: string;
}) {
  // One string under one `truncate`, so the cut lands once, at the end, and
  // never between a separator and what it separates. The genres lead: they
  // are short, and a narrow row can best spare the end of the names.
  const line = [song.genres.map((genre) => genre.name).join(" · "), songByline(song)]
    .filter(Boolean)
    .join(" · ");
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
        "block",
        songRowBox,
        !inRow && "transition-colors hover:bg-accent-subtle active:bg-accent-subtle",
        // A bar as well as the fill, so the open song still stands apart from
        // the row under the pointer. Drawn over the padding, not as a border,
        // so it takes no width from the text. `SongRow` draws the same.
        !inRow &&
          current &&
          "relative bg-accent-subtle before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-accent",
      )}
    >
      {/* h2: both pages that list cards (the catalog and a list) put them
          directly under the page's h1, and an h3 there skips a level. */}
      <h2 className={songRowTitle}>{song.title}</h2>
      {/* Always rendered; `min-h-lh` gives an empty <p> its line box.
          `fg-tertiary`, not `fg-muted`: the open song's row is a fill. */}
      <p className={songRowLine}>{line}</p>

      {song.snippet && (
        <Snippet
          text={song.snippet}
          className="mt-1 line-clamp-2 text-sm leading-relaxed whitespace-pre-line text-fg-tertiary"
        />
      )}
    </Link>
  );
});

/**
 * Rows standing in for songs still loading, built from a row's own box and line
 * classes so they hold its height. Rendered inside a `songRows` box, as rows
 * are, so the rules between them and their width are the rows' too.
 */
export function SongCardSkeletons({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders with nothing else to key on.
    <div key={index} aria-hidden className={songRowBox}>
      {/* Each bar centered in a line box of the text it stands for. */}
      <div className={cn(songRowTitle, "flex h-lh items-center")}>
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className={cn(songRowLine, "flex items-center")}>
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  ));
}
