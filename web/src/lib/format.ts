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
