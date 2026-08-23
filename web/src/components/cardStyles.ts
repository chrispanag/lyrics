/*
 * The chrome of a card — the bordered panel a song, a list, a user, and the bar
 * naming the list a song is being read from are each shown in.
 *
 * Shared for the reason `rowControlChrome` next door is: five sites stated the
 * same border, and the brand hover twice character for character, and the copies
 * had already begun to drift, and nothing failed to say so: the lists index had a
 * partial version of the accent below, the border without the tint, until this
 * module took it over.
 *
 * Split in two, and neither holds a background or padding: `cn` is a plain join,
 * so a caller cannot take a property back out — and the hover belongs only to
 * the cards that are links. Every caller sets its own ground and its own
 * padding, which are the two that differ between them.
 */

/** The resting border, shared by everything card-shaped. */
export const cardChrome = "rounded-2xl border border-stone-200 dark:border-stone-800";

/** The accent a card takes under the pointer, for the cards that are links. */
export const cardHover =
  "transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:hover:border-brand-800 dark:hover:bg-stone-800/60";
