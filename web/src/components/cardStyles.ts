/*
 * The chrome of a card: the bordered box around a list on Your lists, a user or
 * a genre in the admin console, a recording in the song editor, and the bar that
 * steps through a list. Songs in a list or the catalog are rows instead, set in
 * `songRows`.
 *
 * No background or padding, since `cn` cannot take a property back out; each
 * caller sets its own. The hover is separate, for cards that are links.
 */

/** The resting border, shared by everything card-shaped. */
export const cardChrome = "rounded-card border border-line";

/**
 * A filled panel set into the page rather than bordered: a song's notes, the
 * account details. Padding included, since every panel has the same.
 */
export const panelChrome = "rounded-card bg-panel p-4";

/** The accent a card takes under the pointer, for the cards that are links. */
export const cardHover = "transition-colors hover:border-line-accent hover:bg-accent-subtle";

/** A small label on a card or header: a list's visibility. */
export const tagChrome = "rounded-full bg-subtle px-2 py-0.5 text-xs text-fg-tertiary";

/**
 * The box that holds song rows, in the catalog and in a list: a rule between
 * rows, and pulled into the pane's gutter by as much as a row's own padding
 * (`px-3` in SongCard), so a title lines up with the heading and the count
 * above while a row's fill reaches past them. A song row has no border of its
 * own, so a list row's handle and remove button sit inside the same band as
 * its song.
 *
 * The pane's gutter is `px-4` (`ReaderPane`), so the pull must stay smaller.
 */
export const songRows = "-mx-3 divide-y divide-line";
