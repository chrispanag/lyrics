/*
 * Chrome shared by the song page and the server's copy of it (`SongPreview`),
 * which must match it. Kept out of the component files, which export only
 * components so fast refresh keeps working.
 */

/**
 * A genre in a song's header. No hover, since `cn` cannot take one back out
 * and the preview's links do nothing until the app arrives; the app adds its own.
 *
 * Not `SongCard`'s chip, which is deliberately smaller and quieter.
 */
export const genreLinkChrome =
  "rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-fg-secondary";
