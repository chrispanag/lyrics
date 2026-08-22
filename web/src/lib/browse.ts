import type { SongFilters } from "@/lib/types";

/*
 * Addresses into the catalog.
 *
 * Three places link into it from outside — a credit, a genre chip, and the
 * quick search's way to the rest of its matches — and each one used to spell out
 * the route and the parameter itself. CLAUDE.md already records what that costs:
 * a link built by hand with the wrong parameter still answers, with the
 * unfiltered catalog, which reads as "this artist is on every song" rather than
 * as a broken link. The same failure with `q` reads as a search that went
 * nowhere.
 *
 * The filters are `SongFilters` keys, so the names here are the same names the
 * listing and the API use, and renaming one is a compile error rather than three
 * dead links. `BrowsePage` still reads its own parameters from the URL by hand:
 * it owns them, the way `SongDetailPage` owns the `?list=` it reads while
 * `lib/listContext` builds it.
 */

/** The catalog, filtered by whatever is given. */
export function browseHref(filters: Pick<SongFilters, "q" | "person" | "genre_slug">): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }

  const query = params.toString();
  return query ? `/?${query}` : "/";
}
