/**
 * The catalog's own words, shared by the homepage HTML and its Markdown
 * representation so the two cannot drift. Long enough that a reader with no
 * JavaScript, and a client that only sees the raw document, still gets the
 * catalog rather than the navigation.
 */

/** The homepage's H1. The tab stays "Browse"; this names the catalog. */
export const CATALOG_HEADING = "Greek and English song lyrics";

/** Prose under the song list. Each entry is one paragraph. */
export const CATALOG_ABOUT = [
  "Songfolio is a catalog of Greek and English song lyrics. Every song has its words, the people who composed it and wrote the lyrics, the recordings that performed it, the year of that recording, and a YouTube video when one exists.",
  "Search titles, lyrics, and people's names. Accents and capitalization do not change a match, and a close misspelling of a name still finds the person. Greek is searched in Greek script. A person's page lists every song they wrote or performed, and a genre's page lists that style alone. The list can be sorted by popularity, by title, or by year.",
  "Anyone can read and search the whole catalog without an account. An account adds personal lists of songs. Contributors add songs, and administrators look after people, genres, and accounts.",
] as const;

/**
 * The closing paragraph. The homepage turns the named resources into links;
 * Markdown uses the same sentence and then lists those addresses.
 */
export const CATALOG_PROGRAMS =
  "Programs can read the same catalog without rendering this page. The agent guide describes every address, the sitemap lists every song, and the OpenAPI specification describes the JSON API and the OAuth scopes a client can request.";

/** The visible catalog text, for the length a document has to clear. */
export function catalogText(): string {
  return [CATALOG_HEADING, "About the catalog", ...CATALOG_ABOUT, CATALOG_PROGRAMS].join(" ");
}
