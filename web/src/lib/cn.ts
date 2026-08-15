/**
 * Joins class names, dropping falsy entries.
 *
 * Deliberately not tailwind-merge: nothing here relies on later classes
 * overriding earlier ones, so the extra dependency would buy nothing.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
