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
import {
  Button,
  Chip,
  EmptyState,
  ErrorMessage,
  Select,
  Sheet,
  Skeletons,
  Tally,
} from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { LANGUAGE_LABELS, hasRole } from "@/lib/types";
import { catalogName, catalogQuery, catalogView, viewGenre } from "@/lib/browse";
import { useCatalogPaneShown } from "@/lib/catalogPane";
import { songCount } from "@/lib/format";
import { songRefFromPath } from "@/lib/listContext";
import { Link, usePathname, useSearchParams, useSetSearchParams } from "@/lib/navigation";

/** Browse and search. Filter state lives in the URL, so it is shareable. */
export function BrowsePage() {
  const params = useSearchParams();
  const setParams = useSetSearchParams();
  const { user } = useAuth();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Derived as the server route derives it (`app/(shell)/(reader)/catalogPage.tsx`), so the
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

  // Every read here takes it, so a list not yet shown asks for nothing.
  const shown = useCatalogPaneShown();
  const {
    data,
    // Not `isLoading`: a list held back while hidden has nothing loading, but
    // when it shows it must show the skeletons, not "0 songs".
    isPending,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useSongPages(filters, shown);
  const { data: genres } = useGenres(shown);

  const setParam = (key: string, value: string | null) => {
    setParams((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  };

  const activeGenre = viewGenre(view, genres?.data);
  // Fetched by id so the chip can show a name rather than a UUID.
  const { data: activePerson } = usePerson(personId, shown);
  // The one list of what counts as a filter; the button and badge both read it.
  const filterCount = [personId, genreSlug, language].filter(Boolean).length;
  const hasFilters = filterCount > 0;
  const total = data?.total ?? 0;
  const songs = data?.songs ?? [];

  // Named by the query or the landing filter, since each is a history entry
  // and a bookmark; `generateMetadata`'s `og:title` is the same name.
  const name = catalogName(view, { person: activePerson, genre: activeGenre }) ?? "Browse";
  // Beside an open song the song names the tab and the page, and this column
  // is the list. On its own it is the page.
  const besideSong = songRefFromPath(usePathname()) !== null;
  // The filters each card's link keeps, so the list beside the song is this one.
  const cardSearch = catalogQuery(params);

  return (
    // Beside the lyrics the pane is a fixed column. The search stays put and
    // only the songs scroll, so the scrollbar starts under the header.
    <div className="@3xl/app:flex @3xl/app:min-h-0 @3xl/app:flex-1 @3xl/app:flex-col">
      {!besideSong && <PageTitle name={name} />}
      {/* Hidden: the search box is the page's visible heading in all but name.
          What it holds is the outline's root, which each card's h2 sits under. */}
      {!besideSong && <h1 className="sr-only">{name}</h1>}
      {/* `contents` below `@3xl`: a box only as tall as the header would be
          the sticky header's whole scroll range, and it would scroll away. */}
      <div className="contents @3xl/app:block @3xl/app:shrink-0">
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
      </div>

      <div className="@3xl/app:min-h-0 @3xl/app:flex-1 @3xl/app:overflow-y-auto @3xl/app:overscroll-y-contain">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Tally>{isPending ? "Searching…" : songCount(total)}</Tally>
            {hasRole(user?.role, "contributor") && (
              // A styled Link: an anchor nested in a button is invalid.
              <Link href="/songs/new" prefetch={false} className={buttonClasses("secondary", "sm")}>
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
          {isPending && <Skeletons count={5} className="h-28 w-full" />}

          {!isPending && data && songs.length === 0 && (
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
              <SongCard key={song.id} song={song} search={cardSearch} />
            ))}
          </div>

          {isFetchingNextPage && (
            <Skeletons count={2} className="h-28 w-full" stackClassName="mt-3 space-y-3" />
          )}

          {isFetchNextPageError && (
            // Not retried by scrolling: a failing API would be asked on every pixel.
            <div className="mt-4 space-y-3">
              <ErrorMessage>{errorMessage(error, "More songs could not be loaded.")}</ErrorMessage>
              <Button
                variant="secondary"
                size="sm"
                // Waits out a refetch rather than cancelling it, as the trigger does.
                onClick={() => fetchNextPage({ cancelRefetch: false })}
              >
                Try again
              </Button>
            </div>
          )}

          {/* Not while a refetch runs either: `fetchNextPage` would cancel it and
            append to the stale pages it was replacing. */}
          {hasNextPage && !isFetching && !isFetchNextPageError && (
            <InfiniteScrollTrigger onLoadMore={() => fetchNextPage()} />
          )}
        </div>
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
                <option value="popularity">Most popular</option>
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
    </div>
  );
}
