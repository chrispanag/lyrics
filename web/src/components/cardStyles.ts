/*
 * The chrome of a card: the bordered panel lists and users are shown in. Songs
 * are rows instead, ruled apart by `rowDividers`.
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
 * The rule between song rows, set on the list that holds them. A song row has
 * no border of its own, so a list row's handle and remove button sit inside
 * the same band as its song.
 */
export const rowDividers = "divide-y divide-line";
