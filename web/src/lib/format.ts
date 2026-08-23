/**
 * Renders a tally with the right plural.
 *
 * The noun and its plural rule were written out at every screen that shows one
 * of these phrases, so changing the wording meant finding all of them first —
 * and the browse header had already drifted into a template literal while the
 * others used JSX interpolation. Only the regular `-s` nouns belong here; an
 * irregular one needs its plural passed rather than this rule bent around it.
 */
export function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The two tallies the app actually shows, named so the call sites read as
 * English rather than as a helper invocation. Four screens name a song count;
 * the song page's recordings affordance and the sheet it opens both name a
 * recording count.
 */
export const songCount = (n: number): string => pluralize(n, "song");
export const recordingCount = (n: number): string => pluralize(n, "recording");
