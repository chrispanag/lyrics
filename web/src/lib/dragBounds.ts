import type { Modifier } from "@dnd-kit/core";

/**
 * Holds a dragged row on the list's vertical axis and inside its bounds.
 *
 * A list is a column, so sideways travel expresses nothing — and left
 * unconstrained a row follows the pointer anywhere on the page, drifting out of
 * the list it belongs to and over the rest of the layout. Vertical movement is
 * also all the sortable strategy reads, so the freedom was never doing anything
 * except making the drag look broken.
 *
 * `transform.y` is the distance travelled from where the row started, so the
 * bounds are the container's edges expressed in that same relative form.
 */
export const verticalWithinList: Modifier = ({
  transform,
  draggingNodeRect,
  containerNodeRect,
}) => {
  // Before the first measurement there is nothing to clamp against, but the
  // axis still holds.
  if (!draggingNodeRect || !containerNodeRect) return { ...transform, x: 0 };

  const highest = containerNodeRect.top - draggingNodeRect.top;
  const lowest = containerNodeRect.bottom - draggingNodeRect.bottom;

  return { ...transform, x: 0, y: Math.min(Math.max(transform.y, highest), lowest) };
};
