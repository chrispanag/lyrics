import type { SongFilters } from "@/lib/types";

/*
 * Addresses into the catalog. A hand-built link with the wrong parameter still
 * answers, with the unfiltered catalog, so build them here: the keys are
 * `SongFilters` keys, and a rename is a compile error rather than a dead link.
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
