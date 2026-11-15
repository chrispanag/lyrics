"use client";

import { useEffect, useState } from "react";
import { Plus, SixteenthNotes, SlidersHorizontal } from "lucide-react";

import { errorMessage } from "@/api/client";
import { useGenres, usePerson, useSongPages } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { buttonClasses } from "@/components/buttonStyles";
import { InfiniteScrollTrigger } from "@/components/InfiniteScrollTrigger";
import { PageTitle } from "@/components/PageTitle";
import { SearchField } from "@/components/SearchField";
import { SearchHeader } from "@/components/SearchHeader";
import { SongCard } from "@/components/SongCard";
import { Button, Chip, EmptyState, ErrorMessage, Select, Sheet, Skeletons } from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { LANGUAGE_LABELS, type Song, hasRole } from "@/lib/types";
import { catalogName, catalogView, viewGenre } from "@/lib/browse";
import { songCount } from "@/lib/format";
import { Link, useSearchParams, useSetSearchParams } from "@/lib/navigation";

/** Browse and search. Filter state lives in the URL, so it is shareable. */
export function BrowsePage() {
  const params = useSearchParams();
  const setParams = useSetSearchParams();
  const { user } = useAuth();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Derived as the server route derives it (`app/(shell)/page.tsx`), so the
  // query it read ahead is the query asked for here. Not memoized:
  // react-query hashes query keys structurally.
  const view = catalogView(params);
  const { query, genreSlug, language, personId, activeSort, filters } = view;
  const [draft, setDraft] = useState(query);

  // Re-synced to the URL during render, not in an effect: an effect leaves the
  // stale query for one render, and the push effect below writes it back over
  // a Back navigation (with `replace`), so Back appears to do nothing.
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (query !== syncedQuery) {
    setSyncedQuery(query);
    setDraft(query);
  }

  const debounced = useDebounced(draft, 250);

  // Pushes the debounced input into the URL, replacing history per keystroke.
  // Both guards are load-bearing: the first skips a debounce still catching up;
  // the second stops this rewriting the address after every param write, since
  // `setParams` is not referentially stable.
  useEffect(() => {
    if (debounced !== draft) return;
    if (debounced === query) return;

    // biome-ignore lint/nursery/useReactCompiler: syncing the debounced input out to the URL is what this effect is for.
    setParams(
      (next) => {
        if (debounced) next.set("q", debounced);
        else next.delete("q");
      },
      { replace: true },
    );
  }, [debounced, draft, query, setParams]);

  const {
    data,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useSongPages(filters);
  const { data: genres } = useGenres();

  const setParam = (key: string, value: string | null) => {
    setParams((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  };

  const activeGenre = viewGenre(view, genres?.data);
  // Fetched by id so the chip can show a name rather than a UUID.
  const { data: activePerson } = usePerson(personId);
  // The one list of what counts as a filter; the button and badge both read it.
  const filterCount = [personId, genreSlug, language].filter(Boolean).length;
  const hasFilters = filterCount > 0;
  // The latest page's count, which sees songs added or removed since the first.
  const total = data?.pages.at(-1)?.meta.total ?? 0;
  // Offsets shift when a song is added mid-scroll, which repeats one across
  // two pages; a key seen twice is a React error, so each song shows once.
  const songs = uniqueById(data?.pages.flatMap((page) => page.data) ?? []);

  // Named by the query or the landing filter, since each is a history entry
  // and a bookmark; `generateMetadata`'s `og:title` is the same name.
  const name = catalogName(view, { person: activePerson, genre: activeGenre }) ?? "Browse";

  return (
    <>
      <PageTitle name={name} />
      {/* Hidden: the search box is the page's visible heading in all but name.
          What it holds is the outline's root, which each card's h2 sits under. */}
      <h1 className="sr-only">{name}</h1>
      <SearchHeader
        trailing={
          <Button
            // Square with a corner badge, so a filter count never resizes the field.
            size="icon"
            variant={hasFilters ? "primary" : "secondary"}
            onClick={() => setFiltersOpen(true)}
            // The count is in the label: `aria-label` hides the badge from AT.
            // A bare number, not "(1", so the label holds the badge's visible
            // text as a word, which voice control matches on.
            aria-label={hasFilters ? `Filters, ${filterCount} active` : "Filters"}
            className="relative"
          >
            <SlidersHorizontal aria-hidden className="size-5" />
            {hasFilters && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-fg-accent-subtle"
              >
                {filterCount}
              </span>
            )}
          </Button>
        }
        below={
          hasFilters && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {personId && (
                <Chip onRemove={() => setParam("person", null)}>
                  {activePerson?.name ?? "Artist"}
                </Chip>
              )}
              {/* Keyed on the URL, not on the genre resolving: a deleted genre
                  must still leave a chip to clear. */}
              {genreSlug && (
                <Chip onRemove={() => setParam("genre_slug", null)}>
                  {activeGenre?.name ?? genreSlug}
                </Chip>
              )}
              {language && (
                <Chip onRemove={() => setParam("language", null)}>
                  {LANGUAGE_LABELS[language] ?? language}
                </Chip>
              )}
            </div>
          )
        }
      >
        <SearchField value={draft} onChange={setDraft} />
      </SearchHeader>

      <div className="mx-auto max-w-3xl px-4 py-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-fg-muted" aria-live="polite">
            {isLoading ? "Searching…" : songCount(total)}
          </p>
          {hasRole(user?.role, "contributor") && (
            // A styled Link: an anchor nested in a button is invalid.
            <Link href="/songs/new" className={buttonClasses("secondary", "sm")}>
              <Plus aria-hidden className="size-4" />
              Add song
            </Link>
          )}
        </div>

        {/* A later page's failure is said where it happened, below the list. */}
        {isError && !isFetchNextPageError && (
          <ErrorMessage>{errorMessage(error, "Songs could not be loaded.")}</ErrorMessage>
        )}

        {/* `h-28` restates a song card's height; update it if cards change. */}
        {isLoading && <Skeletons count={5} className="h-28 w-full" />}

        {!isLoading && data && songs.length === 0 && (
          <EmptyState
            icon={<SixteenthNotes className="size-12" />}
            title={query ? "No songs matched" : "No songs yet"}
            description={
              query
                ? "Try fewer words, or check the spelling."
                : "Songs added to the catalog will appear here."
            }
          />
        )}

        <div className="space-y-3">
          {songs.map((song) => (
            <SongCard key={song.id} song={song} />
          ))}
        </div>

        {isFetchingNextPage && (
          <Skeletons count={2} className="h-28 w-full" stackClassName="mt-3 space-y-3" />
        )}

        {isFetchNextPageError ? (
          // Not retried by scrolling: a failing API would be asked on every pixel.
          <div className="mt-4 space-y-3">
            <ErrorMessage>{errorMessage(error, "More songs could not be loaded.")}</ErrorMessage>
            <Button variant="secondary" size="sm" onClick={() => fetchNextPage()}>
              Try again
            </Button>
          </div>
        ) : (
          hasNextPage &&
          !isFetchingNextPage && <InfiniteScrollTrigger onLoadMore={() => fetchNextPage()} />
        )}
      </div>

      {/* Gated so the sheet body is not built on every keystroke while closed. */}
      {filtersOpen && (
        <Sheet open onClose={() => setFiltersOpen(false)} title="Filters">
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-medium text-fg-secondary">Genre</h3>
              <div className="flex flex-wrap gap-2">
                {genres?.data.map((genre) => (
                  <Chip
                    key={genre.id}
                    active={genre.slug === genreSlug}
                    onClick={() =>
                      setParam("genre_slug", genre.slug === genreSlug ? null : genre.slug)
                    }
                  >
                    {genre.name}
                    {genre.song_count !== undefined && (
                      <span className="opacity-60">{genre.song_count}</span>
                    )}
                  </Chip>
                ))}
                {genres?.data.length === 0 && (
                  <p className="text-sm text-fg-muted">No genres yet.</p>
                )}
              </div>
            </div>

            <div>
              <label
                htmlFor="filter-language"
                className="mb-2 block text-sm font-medium text-fg-secondary"
              >
                Language
              </label>
              <Select
                id="filter-language"
                className="w-full"
                value={language}
                onChange={(event) => setParam("language", event.target.value || null)}
              >
                <option value="">Any language</option>
                <option value="el">Greek</option>
                <option value="en">English</option>
              </Select>
            </div>

            <div>
              <label
                htmlFor="filter-sort"
                className="mb-2 block text-sm font-medium text-fg-secondary"
              >
                Sort by
              </label>
              <Select
                id="filter-sort"
                className="w-full"
                value={activeSort}
                onChange={(event) => setParam("sort", event.target.value || null)}
              >
                {query ? <option value="relevance">Relevance</option> : null}
                <option value="title">Title (A–Z)</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </Select>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() =>
                  setParams((next) => {
                    // Every key `filterCount` counts must be cleared here.
                    next.delete("person");
                    next.delete("genre_slug");
                    next.delete("language");
                    next.delete("sort");
                  })
                }
              >
                Clear all
              </Button>
              <Button className="flex-1" onClick={() => setFiltersOpen(false)}>
                Show results
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** The songs in their order, each kept at its first appearance. */
function uniqueById(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter((song) => !seen.has(song.id) && Boolean(seen.add(song.id)));
}
