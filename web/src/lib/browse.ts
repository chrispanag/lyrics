import type { Genre, Person, SongFilters } from "@/lib/types";

/*
 * The catalog's address, in both directions. A hand-built link with the wrong
 * parameter still answers, with the unfiltered catalog, so build them here: the
 * keys are `SongFilters` keys, and a rename is a compile error rather than a
 * dead link. And read them here, since `BrowsePage` and the server route that
 * reads ahead of it must derive the same query from the same address — the
 * query key is what hands the server's read to the page, and two derivations
 * drifting apart is a page that silently fetches everything twice.
 */

/** The filters a catalog address carries, in the order `catalogView` reads them. */
const CATALOG_KEYS = ["q", "person", "genre_slug", "language", "sort"] as const;

/**
 * Those filters as a query string. A song opened from the list keeps them, so
 * the column beside the lyrics is the list the reader was on.
 */
export function catalogQuery(params: SearchReader): string {
  const query = new URLSearchParams();
  for (const key of CATALOG_KEYS) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return query.toString();
}

/** The catalog, filtered by whatever is given. */
export function browseHref(filters: Pick<SongFilters, "q" | "person" | "genre_slug">): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }

  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/**
 * The address a person's catalog page is canonical under. The route's
 * canonical and the sitemap both build it here, so the two cannot name one
 * page in two spellings.
 */
export function personPageHref(personId: string): string {
  return browseHref({ person: personId });
}

/** The address a genre's catalog page is canonical under; see `personPageHref`. */
export function genrePageHref(slug: string): string {
  return browseHref({ genre_slug: slug });
}

/** How many songs each step of the infinite list fetches. */
const PAGE_SIZE = 20;

const SORTS = ["relevance", "title", "newest", "oldest", "popularity"] as const;

/** What reading the address needs: the seam's search params and `URLSearchParams` both fit. */
interface SearchReader {
  get(key: string): string | null;
}

/**
 * What a view is of: a search, one person's songs, one genre's, two filters at
 * once, or the catalog itself. The one place that decides it, for the name,
 * the description and whether the view is a page worth indexing.
 */
export type CatalogSubject = "search" | "person" | "genre" | "mixed" | "catalog";

/** What the catalog shows at an address, and the request that fetches it. */
export interface CatalogView {
  subject: CatalogSubject;
  query: string;
  genreSlug: string;
  language: string;
  personId: string;
  /** The ordering in effect, which the sort picker shows: never absent. */
  activeSort: NonNullable<SongFilters["sort"]>;
  /** What `useSongPages` is asked for, and so what its key is built from. */
  filters: SongFilters;
}

/** The catalog view an address asks for. */
export function catalogView(params: SearchReader): CatalogView {
  const query = params.get("q") ?? "";
  const genreSlug = params.get("genre_slug") ?? "";
  const language = params.get("language") ?? "";
  // Song pages link every credit to `/?person=<id>`; unread, an artist link
  // silently lands on the unfiltered catalog.
  const personId = params.get("person") ?? "";

  // Validated rather than cast: the API rejects an unknown sort. Relevance
  // without a query folds back to the default, and an absent sort is the
  // default, named.
  const sortParam = params.get("sort") ?? "";
  const sort = (SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as CatalogView["activeSort"])
    : undefined;
  const requested = sort === "relevance" && !query ? undefined : sort;
  const activeSort = requested ?? (query ? "relevance" : "newest");

  return {
    subject: query
      ? "search"
      : personId && genreSlug
        ? "mixed"
        : personId
          ? "person"
          : genreSlug
            ? "genre"
            : "catalog",
    query,
    genreSlug,
    language,
    personId,
    activeSort,
    filters: {
      q: query || undefined,
      person: personId || undefined,
      genre_slug: genreSlug || undefined,
      language: language || undefined,
      sort: activeSort,
      limit: PAGE_SIZE,
    },
  };
}

/** The genre a view is filtered by, among those read; how a slug matches is decided here. */
export function viewGenre(view: CatalogView, genres: Genre[] | undefined): Genre | undefined {
  return view.genreSlug ? genres?.find((genre) => genre.slug === view.genreSlug) : undefined;
}

/**
 * The view's name: the tab, the hidden heading and `og:title` all read it, so
 * the server's document and an in-app visit name the view alike. Undefined for
 * a view with no name of its own — the catalog, a combination, or a filter
 * whose record has not resolved (rather than naming it by its id) — and each
 * caller says what it calls that.
 */
export function catalogName(
  view: CatalogView,
  named: { person?: Person | undefined; genre?: Genre | undefined },
): string | undefined {
  switch (view.subject) {
    case "search":
      return `Search: ${view.query}`;
    case "person":
      return named.person ? `Songs by ${named.person.name}` : undefined;
    case "genre":
      return named.genre ? `${named.genre.name} songs` : undefined;
    default:
      return undefined;
  }
}
