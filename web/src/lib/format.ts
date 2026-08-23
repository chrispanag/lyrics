/**
 * Renders a song tally with the right plural.
 *
 * Four screens show this same phrase. Written out at each of them, the noun and
 * its plural rule were four things to find before the wording could change at
 * all — and the browse header had already drifted into a template literal while
 * the others used JSX interpolation.
 */
export function songCount(n: number): string {
  return `${n} ${n === 1 ? "song" : "songs"}`;
}

/**
 * Renders a recording tally with the right plural, like songCount above and for
 * the same reason: the song page's affordance and the sheet it opens both name
 * the count, and a third caller is one edit away.
 */
export function recordingCount(n: number): string {
  return `${n} ${n === 1 ? "recording" : "recordings"}`;
}
