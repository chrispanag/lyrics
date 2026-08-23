/*
 * The size a reader chose to read lyrics at, and where it is kept.
 *
 * Apart from the page that draws it for the same reason `lib/theme.ts` is apart
 * from the switch that sets it: this is a `localStorage` read, and a
 * `localStorage` read is the one thing in a render body that cannot be run
 * anywhere but a browser. Kept here, it is a module a server-side render can
 * import and call without a DOM behind it, which is what `serverRender.test.tsx`
 * asks of it — where the same read left inline in `SongDetailPage.tsx` could
 * only be pinned by rendering that whole page.
 */

/** Reader font sizes, persisted so the choice survives navigation. */
export const FONT_SIZES = ["text-base", "text-lg", "text-xl", "text-2xl"] as const;

export const DEFAULT_FONT_SIZE = 1;

const FONT_SIZE_KEY = "lyrics:font-size";

/**
 * The stored size, or the default when there is nothing usable stored.
 *
 * Wrapped like `auth/storedUser`'s read and the theme boot script's, and for
 * both of the reasons they are: a browser can refuse to hand its storage over,
 * and there may one day be no storage to ask. It is not what makes the choice
 * safe to render — that is the layout effect at the call site, since a value
 * only the browser has cannot be part of a first render the server also
 * performed — but it is what makes this module safe to *import* and call from
 * one.
 */
export function storedFontSize(): number {
  try {
    // The absent-key case has to be caught before Number(): localStorage returns
    // null, Number(null) is 0, and 0 is a perfectly valid index — so the
    // intended default of text-lg was unreachable and every first-time reader
    // silently got the smallest size.
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    if (raw === null) return DEFAULT_FONT_SIZE;
    const stored = Number(raw);
    return Number.isInteger(stored) && stored >= 0 && stored < FONT_SIZES.length
      ? stored
      : DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

/** Records the choice, for the next page this reader opens. */
export function storeFontSize(index: number): void {
  try {
    localStorage.setItem(FONT_SIZE_KEY, String(index));
  } catch {
    // A size that cannot be remembered still applies to the song being read.
  }
}
