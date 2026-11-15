/*
 * Chrome shared by the song page and the server's copy of it (`SongPreview`),
 * which must match it. Kept out of the component files, which export only
 * components so fast refresh keeps working.
 */

/**
 * A genre in a song's header. No hover, since `cn` cannot take one back out
 * and the preview's links do nothing until the app arrives; the app adds its own.
 *
 * `block` because the two sit in different parents: the app's link is a flex
 * item, which is blockified anyway, while the preview's is an `<a>` inside an
 * `<li>`, where an inline box's vertical padding paints without counting — so
 * its pill came out shorter than the app's by the gap between `text-xs`'s
 * content area and its line height.
 *
 * Not `SongCard`'s chip, which is deliberately smaller and quieter.
 */
export const genreLinkChrome =
  "block rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-fg-secondary";
