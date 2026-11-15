import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Music4, Plus, SlidersHorizontal } from "lucide-react";

import { errorMessage } from "@/api/client";
import { useGenres, usePerson, useSongs } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { buttonClasses } from "@/components/buttonStyles";
import { PageTitle } from "@/components/PageTitle";
import { SearchField } from "@/components/SearchField";
import { SearchHeader } from "@/components/SearchHeader";
import { SongCard } from "@/components/SongCard";
import { Button, Chip, EmptyState, ErrorMessage, Select, Sheet, Skeleton } from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { LANGUAGE_LABELS, hasRole, type SongFilters } from "@/lib/types";
import { songCount } from "@/lib/format";

const PAGE_SIZE = 20;

const SORTS = ["relevance", "title", "newest", "oldest"] as const;

/**
 * Reads the page number from the URL, treating anything unusable as page one.
 * NaN would pass every comparison as false and break pagination.
 */
function pageNumber(raw: string | null): number {
  const parsed = Number(raw ?? "0");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** Browse and search. Filter state lives in the URL, so it is shareable. */
export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = params.get("q") ?? "";
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
  // the second stops this clearing `page` after every param write, since
  // `setParams` is not referentially stable.
  useEffect(() => {
    if (debounced !== draft) return;
    if (debounced === query) return;

    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (debounced) next.set("q", debounced);
        else next.delete("q");
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [debounced, draft, query, setParams]);

  const page = pageNumber(params.get("page"));
  const genreSlug = params.get("genre_slug") ?? "";
  const language = params.get("language") ?? "";
  // Validated rather than cast: the API rejects an unknown sort.
  const sortParam = params.get("sort") ?? "";
  const sort = (SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as SongFilters["sort"])
    : undefined;
  // Song pages link every credit to `/?person=<id>`; unread, an artist link
  // silently lands on the unfiltered catalog.
  const personId = params.get("person") ?? "";

  // The ordering in effect, which the sort picker shows; an absent `sort` is
  // the default, named. Relevance without a query folds back to the default.
  const requested = sort === "relevance" && !query ? undefined : sort;
  const activeSort = requested ?? (query ? "relevance" : "newest");

  // Not memoized: react-query hashes query keys structurally.
  const filters: SongFilters = {
    q: query || undefined,
    person: personId || undefined,
    genre_slug: genreSlug || undefined,
    language: language || undefined,
    sort: activeSort,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading, isError, error } = useSongs(filters);
  const { data: genres } = useGenres();

  /** Edits the query string. Any filter change resets the page unless `keepPage`. */
  const updateParams = (
    mutate: (next: URLSearchParams) => void,
    options: { keepPage?: boolean } = {},
  ) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      mutate(next);
      if (!options.keepPage) next.delete("page");
      return next;
    });
  };

  const setParam = (key: string, value: string | null) => {
    updateParams((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
  };

  const goToPage = (page: number) => {
    updateParams(
      (next) => {
        if (page <= 0) next.delete("page");
        else next.set("page", String(page));
      },
      { keepPage: true },
    );
  };

  const activeGenre = genres?.data.find((g) => g.slug === genreSlug);
  // Fetched by id so the chip can show a name rather than a UUID.
  const { data: activePerson } = usePerson(personId);
  // The one list of what counts as a filter; the button and badge both read it.
  const filterCount = [personId, genreSlug, language].filter(Boolean).length;
  const hasFilters = filterCount > 0;
  const total = data?.meta.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      {/* Named by the query, since a search is a history entry and a bookmark. */}
      <PageTitle name={query ? `Search: ${query}` : "Browse"} />
      <SearchHeader
        trailing={
          <Button
            // Square with a corner badge, so a filter count never resizes the field.
            size="icon"
            variant={hasFilters ? "primary" : "secondary"}
            onClick={() => setFiltersOpen(true)}
            // The count is in the label: `aria-label` hides the badge from AT.
            aria-label={hasFilters ? `Filters (${filterCount} active)` : "Filters"}
            className="relative"
          >
            <SlidersHorizontal aria-hidden className="size-5" />
            {hasFilters && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-brand-700 dark:bg-stone-900 dark:text-brand-200"
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
          <p className="text-sm text-stone-500 dark:text-stone-400" aria-live="polite">
            {isLoading ? "Searching…" : songCount(total)}
          </p>
          {hasRole(user?.role, "contributor") && (
            // A styled Link: an anchor nested in a button is invalid.
            <Link
              to="/songs/new"
              className={buttonClasses("secondary", "sm")}
            >
              <Plus aria-hidden className="size-4" />
              Add song
            </Link>
          )}
        </div>

        {isError && <ErrorMessage>{errorMessage(error, "Songs could not be loaded.")}</ErrorMessage>}

        {isLoading && (
          <div className="space-y-3">
            {/* `h-28` restates a song card's height; update it if cards change. */}
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
        )}

        {!isLoading && data?.data.length === 0 && (
          <EmptyState
            icon={<Music4 className="size-12" />}
            title={query ? "No songs matched" : "No songs yet"}
            description={
              query
                ? "Try fewer words, or check the spelling."
                : "Songs added to the catalog will appear here."
            }
          />
        )}

        <div className="space-y-3">
          {data?.data.map((song) => (
            <SongCard key={song.id} song={song} />
          ))}
        </div>

        {totalPages > 1 && (
          <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 0}
              onClick={() => goToPage(page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-stone-500">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </nav>
        )}
      </div>

      {/* Gated so the sheet body is not built on every keystroke while closed. */}
      {filtersOpen && (
        <Sheet open onClose={() => setFiltersOpen(false)} title="Filters">
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">Genre</h3>
              <div className="flex flex-wrap gap-2">
                {genres?.data.map((genre) => (
                  <Chip
                    key={genre.id}
                    active={genre.slug === genreSlug}
                    onClick={() => setParam("genre_slug", genre.slug === genreSlug ? null : genre.slug)}
                  >
                    {genre.name}
                    {genre.song_count !== undefined && (
                      <span className="opacity-60">{genre.song_count}</span>
                    )}
                  </Chip>
                ))}
                {genres?.data.length === 0 && (
                  <p className="text-sm text-stone-500">No genres yet.</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="filter-language" className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
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
              <label htmlFor="filter-sort" className="mb-2 block text-sm font-medium text-stone-700 dark:text-stone-300">
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
                  updateParams((next) => {
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
