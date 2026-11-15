/*
 * The reader's chosen lyrics size, and where it is kept. Its own module so
 * `serverRender.test.tsx` can call it without a DOM; see "The Next.js shell" in
 * CLAUDE.md.
 */

/** Reader font sizes, persisted so the choice survives navigation. */
export const FONT_SIZES = ["text-base", "text-lg", "text-xl", "text-2xl"] as const;

export const DEFAULT_FONT_SIZE = 1;

const FONT_SIZE_KEY = "lyrics:font-size";

/**
 * The stored size, or the default when there is nothing usable stored.
 *
 * The try makes this safe to call on a server, not to render with: the call
 * site reads it in a layout effect.
 */
export function storedFontSize(): number {
  try {
    // Check null before Number(): Number(null) is 0, a valid index.
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
