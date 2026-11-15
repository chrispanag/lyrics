/** Renders a tally with the right plural. Regular `-s` nouns only. */
export function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export const songCount = (n: number): string => pluralize(n, "song");
export const recordingCount = (n: number): string => pluralize(n, "recording");
