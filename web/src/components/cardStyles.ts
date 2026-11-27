/*
 * The chrome of a card: the bordered panel songs, lists and users are shown in.
 *
 * No background or padding, since `cn` cannot take a property back out; each
 * caller sets its own. The hover is separate, for cards that are links.
 */

/** The resting border, shared by everything card-shaped. */
export const cardChrome = "rounded-card border border-line";

/**
 * A sheet: the surface every screen's content sits on at a desk, beside the
 * rail — the reader's two panes, and each other screen whole. Only once the
 * content column is `@3xl/app` wide; a phone's page is its own surface.
 *
 * A card's corners, lifted off the page by a hairline ring and a soft shadow.
 * A ring rather than `cardChrome`'s border, which would take a pixel of layout
 * off each edge and cannot be put under `@3xl/app:` from outside. Forced
 * colors drops both ring and shadow, so there the sheet takes a border
 * instead. The sticky bars on it are drawn on the sheet's color.
 */
export const sheetChrome =
  "@3xl/app:rounded-card @3xl/app:bg-surface @3xl/app:shadow-raised @3xl/app:ring-1 @3xl/app:ring-line @3xl/app:[--sticky-bar-bg:var(--color-surface)] forced-colors:@3xl/app:border";

/**
 * Around a screen's sheets: the room between them and the window's edges,
 * `--sheet-inset`, except on the left, where the rail draws no edge of its
 * own. Takes the place of the shell's bottom padding (`Layout`).
 */
export const sheetFrame = "@3xl/app:py-(--sheet-inset) @3xl/app:pr-(--sheet-inset)";

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
