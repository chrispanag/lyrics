import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Music4, Plus, SlidersHorizontal } from "lucide-react";

import { errorMessage } from "@/api/client";
import { useGenres, usePerson, useSongs } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { StickyHeader } from "@/components/Layout";
import { buttonClasses } from "@/components/buttonStyles";
import { SearchField } from "@/components/SearchField";
import { SongCard } from "@/components/SongCard";
import { Button, Chip, EmptyState, ErrorMessage, Select, Sheet, Skeleton } from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { LANGUAGE_LABELS, hasRole, type SongFilters } from "@/lib/types";
import { songCount } from "@/lib/format";

const PAGE_SIZE = 20;

const SORTS = ["relevance", "title", "newest", "oldest"] as const;

/**
 * Reads the page number from the URL, treating anything unusable as page one.
 *
 * `Number("abc")` is NaN, and every comparison against NaN is false — so a
 * truncated or hand-edited link left both pagination buttons enabled, wrote
 * `page=NaN` back on every click, and pinned the reader to the first page under
 * a header reading "Page NaN of 3".
 */
function pageNumber(raw: string | null): number {
  const parsed = Number(raw ?? "0");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

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

  // The box is re-synced to the URL *during render*, not from an effect.
  //
  // An effect runs after the commit, which left `draft` and `debounced` holding
  // the previous query for one render after a back/forward navigation — long
  // enough for the push effect below to write that stale value straight back
  // over the URL the browser had just restored. Because that write is
  // `{ replace: true }`, the restored history entry was overwritten too, so
  // pressing Back on a search appeared to do nothing at all.
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (query !== syncedQuery) {
    setSyncedQuery(query);
    setDraft(query);
  }

  const debounced = useDebounced(draft, 250);

  // Push the debounced input into the URL, replacing history so typing a
  // query does not fill the back stack with one entry per keystroke.
  //
  // Both guards are load-bearing. `setParams` is not referentially stable — its
  // useCallback deps include the parsed params — so this effect re-runs after
  // *any* param write, and without the second guard it would clear `page` again
  // on every one of them, making pagination impossible to advance. The first
  // guard keeps a debounce that has not yet caught up with the box from being
  // mistaken for something the user typed.
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
  // Validated rather than cast: `as` laundered any URL text into the union, so
  // a hand-edited or truncated link put an unknown value on the wire — which
  // the API now rejects outright rather than silently reordering.
  const sortParam = params.get("sort") ?? "";
  const sort = (SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as SongFilters["sort"])
    : undefined;
  // Song pages link every credit to `/?person=<id>`, so this has to be read
  // here — otherwise clicking an artist quietly lands on the unfiltered
  // catalog, which reads as "this artist is on every song".
  const personId = params.get("person") ?? "";

  // The ordering actually in effect, which is what the sort picker shows.
  //
  // An absent `sort` is not "unsorted" — it is whichever default the listing
  // falls back to, so the picker has to name it. Deriving both from one value
  // is what keeps them from disagreeing: while the picker carried its own
  // placeholder option, the no-query case offered "Newest first" twice, once as
  // that placeholder and once as itself.
  //
  // Relevance is meaningless without a query — the API orders by newest for it
  // either way — so a stale `sort=relevance` left over from a cleared search
  // folds back to the default rather than labelling the list wrongly.
  const requested = sort === "relevance" && !query ? undefined : sort;
  const activeSort = requested ?? (query ? "relevance" : "newest");

  // Not memoized: react-query hashes query keys structurally, so a fresh object
  // each render produces the same hash and never re-runs the query. A useMemo
  // here would only add a dependency array to keep in sync.
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
            {/* The same box the song page carries, chrome and quirks included —
                see `SearchField`. This one drives the listing below it rather
                than a panel, so it is handed nothing but its state. */}
            <SearchField value={draft} onChange={setDraft} className="flex-1" />

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
              {/* Keyed on the slug in the URL rather than on the genre being
                  found, the way the artist chip above already is. A genre can
                  be deleted from the admin console while someone holds a link
                  filtered by it: the request still answers, with no songs, so
                  waiting for a name that will never arrive leaves that reader
                  on an empty catalog with a lit filter button and nothing to
                  press to clear it. */}
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
            {/* A song card is one height now that its empty slots are reserved,
                and `h-28` is that height. Restated rather than reserved: a
                skeleton has nothing inside it to take a height from, so this
                is the number to correct by hand if a card's padding or type
                sizes change. A card carrying a search snippet is taller, so
                the rows still move under a query; standing in for the
                unfiltered catalog is the most this can do. */}
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
                    // `person` belongs here too: hasFilters and the filter-count
                    // badge both count it, so leaving it behind made "Clear all"
                    // close the sheet with the artist chip still showing and the
                    // results still filtered.
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
