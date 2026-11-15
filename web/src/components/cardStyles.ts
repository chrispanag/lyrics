/*
 * The chrome of a card: the bordered panel songs, lists and users are shown in.
 *
 * No background or padding, since `cn` cannot take a property back out; each
 * caller sets its own. The hover is separate, for cards that are links.
 */

/** The resting border, shared by everything card-shaped. */
export const cardChrome = "rounded-2xl border border-stone-200 dark:border-stone-800";

/** The accent a card takes under the pointer, for the cards that are links. */
export const cardHover =
  "transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:hover:border-brand-800 dark:hover:bg-stone-800/60";
