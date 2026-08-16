/**
 * Moves one id to another's place, returning a new array.
 *
 * The arithmetic lives here rather than inside the drag component so it can be
 * tested without a DOM — a drag reports which id was picked up and which one it
 * was dropped on, and everything else is this splice.
 */
export function move<T>(items: T[], activeId: T, overId: T): T[] {
  const from = items.indexOf(activeId);
  const to = items.indexOf(overId);
  // An id the list does not hold, or a drop back where it started, leaves the
  // order alone — and returns the original array, so callers can skip the save.
  if (from === -1 || to === -1 || from === to) return items;

  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
