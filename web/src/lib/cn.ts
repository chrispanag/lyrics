/**
 * Joins class names, dropping falsy entries. Not tailwind-merge: later classes
 * do not override earlier ones.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
