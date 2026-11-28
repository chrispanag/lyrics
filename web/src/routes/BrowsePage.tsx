"use client";

import { useEffect, useState } from "react";
import { Plus, SixteenthNotes, SlidersHorizontal } from "lucide-react";

import { errorMessage } from "@/api/client";
import { useGenres, usePerson, useSongPages } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { ButtonLink } from "@/components/ButtonLink";
import { InfiniteScrollTrigger } from "@/components/InfiniteScrollTrigger";
import { PaneHeading, ReaderPane } from "@/components/ReaderSplit";
import { CATALOG_SEARCH_ATTRIBUTE, SearchField } from "@/components/SearchField";
import { SearchHeader } from "@/components/SearchHeader";
import { SongCard } from "@/components/SongCard";
import { songStack, songStackBleed } from "@/components/cardStyles";
import { pageTitle, sectionLabel } from "@/components/textStyles";
import { cn } from "@/lib/cn";
import {
  Button,
  Chip,
  EmptyState,
  ErrorMessage,
  Field,
  Select,
  Sheet,
  Skeletons,
  Tally,
} from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { LANGUAGE_LABELS, hasRole } from "@/lib/types";
import { catalogName, catalogQuery, catalogView, FILTER_KEYS, viewGenre } from "@/lib/browse";
import { useCatalogPaneShown } from "@/lib/catalogPane";
import { songCount } from "@/lib/format";
import { useSearchParams, useSetSearchParams } from "@/lib/navigation";

/** What an empty result suggests, by what narrowed it. */
function emptyHint(searched: boolean, filtered: boolean): string {
  if (searched && filtered) return "Try fewer words, or remove a filter.";
  if (searched) return "Try fewer words, or check the spelling.";
  if (filtered) return "No song matches every filter. Try removing one.";
  return "Songs added to the catalog will appear here.";
}

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

  // The sort is not a filter, so only the sheet's "Clear all" takes it too.
  const clearFilters = ({ sort = false } = {}) =>
    setParams((next) => {
      for (const key of FILTER_KEYS) next.delete(key);
      if (sort) next.delete("sort");
    });

  const setParam = (key: string, value: string | null) => {
    setParams((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  };

  const activeGenre = viewGenre(view, genres?.data);
  // Fetched by id so the chip can show a name rather than a UUID.
  const { data: activePerson } = usePerson(personId, shown);
  // The button and its badge count the same keys the clears lift.
  const filterCount = FILTER_KEYS.filter((key) => filters[key]).length;
  const hasFilters = filterCount > 0;
  const total = data?.total ?? 0;
  const songs = data?.songs ?? [];

  // Named by the query or the landing filter, since each is a history entry
  // and a bookmark; `generateMetadata`'s `og:title` is the same name.
  const named = catalogName(view, { person: activePerson, genre: activeGenre });
  const name = named ?? "Browse";
  // A person's or a genre's page is a place of its own, linked to and indexed,
  // so its name is shown; a search is named by its box, the catalog by nothing.
  const landing = view.subject === "person" || view.subject === "genre" ? named : undefined;
  const empty = !isPending && data !== undefined && songs.length === 0;
  // The filters each card's link keeps, so the list beside the song is this one.
  const cardSearch = catalogQuery(params);

  return (
    <ReaderPane
      title={name}
      header={
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
          {/* Marked for the phone's Search button, which comes here. */}
          <SearchField value={draft} onChange={setDraft} {...{ [CATALOG_SEARCH_ATTRIBUTE]: "" }} />
        </SearchHeader>
      }
    >
      {/* Hidden on a search and the catalog: there the search box is the
          pane's visible heading in all but name. */}
      <PaneHeading className={landing ? `${pageTitle} mb-1` : "sr-only"}>{name}</PaneHeading>
      <div className="mb-4 flex items-center justify-between gap-3">
        {/* Still announced when empty, but not drawn above the empty state,
            which says the same. */}
        <Tally className={empty ? "sr-only" : ""}>
          {isPending ? "Searching…" : songCount(total)}
        </Tally>
        {hasRole(user?.role, "contributor") && (
          <ButtonLink href="/songs/new" prefetch={false} variant="secondary" size="sm">
            <Plus aria-hidden className="size-4" />
            Add song
          </ButtonLink>
        )}
      </div>

      {/* A later page's failure is said where it happened, below the list. */}
      {isError && !isFetchNextPageError && (
        <ErrorMessage>{errorMessage(error, "Songs could not be loaded.")}</ErrorMessage>
      )}

      {/* `h-14` restates the commonest song row's height, a title and a byline
          (`SongCard`); update it if the rows change. */}
      {isPending && <Skeletons count={8} className="h-14 w-full" stackClassName={songStack} />}

      {empty && (
        <EmptyState
          icon={<SixteenthNotes className="size-12" />}
          // A filter that matches nothing is not an empty catalog.
          title={query || hasFilters ? "No songs matched" : "No songs yet"}
          description={emptyHint(Boolean(query), hasFilters)}
          action={
            hasFilters && (
              <Button variant="secondary" size="sm" onClick={() => clearFilters()}>
                Clear filters
              </Button>
            )
          }
        />
      )}

      <div className={`${songStackBleed} ${songStack}`}>
        {songs.map((song) => (
          <SongCard key={song.id} song={song} search={cardSearch} />
        ))}
      </div>

      {isFetchingNextPage && (
        <Skeletons count={2} className="h-14 w-full" stackClassName={`mt-1 ${songStack}`} />
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

      {/* Gated so the sheet body is not built on every keystroke while closed. */}
      {filtersOpen && (
        <Sheet open onClose={() => setFiltersOpen(false)} title="Filters">
          <div className="space-y-5">
            <div>
              <h3 className={cn(sectionLabel, "mb-2")}>Genre</h3>
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

            <Field label="Language" htmlFor="filter-language">
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
            </Field>

            <Field label="Sort by" htmlFor="filter-sort">
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
            </Field>

            <div className="flex gap-2 pt-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => clearFilters({ sort: true })}
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
    </ReaderPane>
  );
}
