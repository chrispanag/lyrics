/*
 * The chrome of a card: the bordered panel songs, lists and users are shown in.
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

/** A small label on a card or header: a genre on a song card, a list's visibility. */
export const tagChrome = "rounded-full bg-subtle px-2 py-0.5 text-xs text-fg-tertiary";

/**
 * `tagChrome` for a tag that is a link: the same tag, padded to a 24px target
 * and lit under the pointer. Its own string, since `cn` cannot replace padding.
 */
export const tagLinkChrome =
  "inline-block rounded-full bg-subtle px-2.5 py-1 text-xs text-fg-tertiary transition-colors hover:bg-muted hover:text-fg-secondary";
