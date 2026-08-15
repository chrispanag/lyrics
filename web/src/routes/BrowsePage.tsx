import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Music4, Plus, Search, SlidersHorizontal, X } from "lucide-react";

import { errorMessage } from "@/api/client";
import { useGenres, usePerson, useSongs } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { StickyHeader } from "@/components/Layout";
import { buttonClasses } from "@/components/buttonStyles";
import { fieldChrome } from "@/components/fieldStyles";
import { SongCard } from "@/components/SongCard";
import { cn } from "@/lib/cn";
import { Button, Chip, EmptyState, ErrorMessage, Select, Sheet, Skeleton } from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { LANGUAGE_LABELS, hasRole, type SongFilters } from "@/lib/types";
import { songCount } from "@/lib/format";

const PAGE_SIZE = 20;

/**
 * Browse and search.
 *
 * Filter state lives in the URL rather than component state so a filtered
 * search can be shared, bookmarked, and survives the back button — which is
 * how people actually navigate a catalog.
 */
export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = params.get("q") ?? "";
  const [draft, setDraft] = useState(query);
  const debounced = useDebounced(draft, 250);

  // Push the debounced input into the URL, replacing history so typing a
  // query does not fill the back stack with one entry per keystroke.
  //
  // The guard is load-bearing. `setParams` is not referentially stable — its
  // useCallback deps include the parsed params — so this effect re-runs after
  // *any* param write, and without the guard it would clear `page` again on
  // every one of them, making pagination impossible to advance.
  useEffect(() => {
    if (debounced === (params.get("q") ?? "")) return;

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
  }, [debounced, params, setParams]);

  // Keep the box in sync when navigation changes the URL underneath it.
  useEffect(() => {
    setDraft(params.get("q") ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("q")]);

  const page = Number(params.get("page") ?? "0");
  const genreSlug = params.get("genre_slug") ?? "";
  const language = params.get("language") ?? "";
  const sort = (params.get("sort") ?? "") as SongFilters["sort"];
  // Song pages link every credit to `/?person=<id>`, so this has to be read
  // here — otherwise clicking an artist quietly lands on the unfiltered
  // catalog, which reads as "this artist is on every song".
  const personId = params.get("person") ?? "";

  // Not memoized: react-query hashes query keys structurally, so a fresh object
  // each render produces the same hash and never re-runs the query. A useMemo
  // here would only add a dependency array to keep in sync.
  const filters: SongFilters = {
    q: query || undefined,
    person: personId || undefined,
    genre_slug: genreSlug || undefined,
    language: language || undefined,
    sort: sort || (query ? "relevance" : "newest"),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading, isError, error } = useSongs(filters);
  const { data: genres } = useGenres();

  /**
   * Edits the query string through one code path.
   *
   * `keepPage` is opt-in because changing any filter invalidates the current
   * offset — the pagination buttons are the only callers that mean to keep it.
   */
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
  const hasFilters = Boolean(genreSlug || language || personId);
  const total = data?.meta.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <StickyHeader>
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-stone-400"
              />
              <input
                type="search"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Search lyrics, titles, artists…"
                aria-label="Search songs"
                // Shares the field chrome but not the layout: this box is taller
                // and rounder than a form <Input>, and cn is a plain join, so
                // passing h-12/rounded-2xl through Input would leave both values
                // in the class list. 16px minimum text, or iOS Safari zooms the
                // page on focus.
                className={cn(fieldChrome, "h-12 w-full rounded-2xl pl-10 pr-10 text-base")}
              />
              {draft && (
                <button
                  type="button"
                  onClick={() => setDraft("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <X aria-hidden className="size-4" />
                </button>
              )}
            </div>

            <Button
              variant={hasFilters ? "primary" : "secondary"}
              size="md"
              onClick={() => setFiltersOpen(true)}
              aria-label="Filters"
              className="shrink-0 px-3"
            >
              <SlidersHorizontal aria-hidden className="size-5" />
              {hasFilters && (
                <span className="text-xs">
                  {[personId, genreSlug, language].filter(Boolean).length}
                </span>
              )}
            </Button>
          </div>

          {hasFilters && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {personId && (
                <Chip onRemove={() => setParam("person", null)}>
                  {activePerson?.name ?? "Artist"}
                </Chip>
              )}
              {activeGenre && (
                <Chip onRemove={() => setParam("genre_slug", null)}>{activeGenre.name}</Chip>
              )}
              {language && (
                <Chip onRemove={() => setParam("language", null)}>
                  {LANGUAGE_LABELS[language] ?? language}
                </Chip>
              )}
            </div>
          )}
        </div>
      </StickyHeader>

      <div className="mx-auto max-w-3xl px-4 py-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-stone-500 dark:text-stone-400" aria-live="polite">
            {isLoading ? "Searching…" : songCount(total)}
          </p>
          {hasRole(user?.role, "contributor") && (
            // A styled Link rather than a Button wrapping one: nesting an
            // anchor inside a button is invalid and breaks keyboard handling.
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
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
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
                value={sort ?? ""}
                onChange={(event) => setParam("sort", event.target.value || null)}
              >
                <option value="">{query ? "Relevance" : "Newest first"}</option>
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
