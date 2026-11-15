/*
 * The reader's chosen lyrics size, and where it is kept. Its own module so
 * `serverRender.test.tsx` can call it without a DOM; see "The Next.js app" in
 * CLAUDE.md.
 *
 * The size is an attribute on <html>, set before first paint by
 * `FONT_SIZE_BOOT_SCRIPT`, and `.lyrics-size` in styles/index.css sizes the
 * lyrics from it. So the server's markup is the same for every reader and the
 * first paint is already at the stored size, which a class chosen by React
 * state could only be after hydration.
 */

/**
 * The steps, smallest first, as the Tailwind size tokens `.lyrics-size` reads
 * for each value of the attribute. index.css spells them out; change both.
 */
export const FONT_SIZES = ["--text-base", "--text-lg", "--text-xl", "--text-2xl"] as const;

/** What `.lyrics-size` is with no attribute, so a reader who never chose is here. */
export const DEFAULT_FONT_SIZE = 1;

const FONT_SIZE_KEY = "lyrics:font-size";

/** On <html>; `.lyrics-size` in index.css is keyed on it. */
export const FONT_SIZE_ATTRIBUTE = "data-lyrics-size";

/**
 * The stored size, or the default when there is nothing usable stored.
 *
 * The try makes this safe to call on a server, not to render with: the call
 * site reads it in a layout effect, for the buttons' limits only.
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

/**
 * The step the lyrics are drawn at now, for the size buttons' limits: the
 * attribute when there is one, else `storedFontSize()`. The attribute outlives
 * a client navigation while a write to storage can fail, so reading storage
 * alone would leave the buttons on the default beside lyrics drawn at another
 * step. Browser only; the call site reads it in a layout effect.
 */
export function drawnFontSize(): number {
  const drawn = Number(document.documentElement.getAttribute(FONT_SIZE_ATTRIBUTE) ?? Number.NaN);
  return Number.isInteger(drawn) && drawn >= 0 && drawn < FONT_SIZES.length
    ? drawn
    : storedFontSize();
}

/** Shows the lyrics at `index`, when the reader changes it. The first is the boot script's. */
export function applyFontSize(index: number): void {
  document.documentElement.setAttribute(FONT_SIZE_ATTRIBUTE, String(index));
}

/** Records the choice, for the boot script to read on the next load. */
export function storeFontSize(index: number): void {
  try {
    localStorage.setItem(FONT_SIZE_KEY, String(index));
  } catch {
    // A size that cannot be remembered still applies to the song being read.
  }
}

/**
 * The same decision as `storedFontSize()`, as source for the inline <script>
 * app/layout.tsx renders, so the lyrics are at the stored size from the first
 * paint. Nothing usable stored leaves the attribute off, which is the default.
 *
 * Mirrors `storedFontSize`; change both (`fontSize.test.ts` holds them
 * together). `let`, not `var`: an inline script runs in global scope.
 */
export const FONT_SIZE_BOOT_SCRIPT =
  `try{` +
  `let r=localStorage.getItem(${JSON.stringify(FONT_SIZE_KEY)});` +
  `let n=Number(r);` +
  `if(r!==null&&Number.isInteger(n)&&n>=0&&n<${FONT_SIZES.length})` +
  `document.documentElement.setAttribute(${JSON.stringify(FONT_SIZE_ATTRIBUTE)},String(n))` +
  `}catch(e){}`;
