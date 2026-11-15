import type { Modifier } from "@dnd-kit/core";

/**
 * Holds a dragged row on the list's vertical axis and inside its bounds.
 *
 * `transform.y` is relative to where the row started, so the bounds are the
 * container's edges in that same relative form.
 */
export const verticalWithinList: Modifier = ({
  transform,
  draggingNodeRect,
  containerNodeRect,
}) => {
  // Not yet measured: nothing to clamp against, but the axis still holds.
  if (!draggingNodeRect || !containerNodeRect) return { ...transform, x: 0 };

  const highest = containerNodeRect.top - draggingNodeRect.top;
  const lowest = containerNodeRect.bottom - draggingNodeRect.bottom;

  return { ...transform, x: 0, y: Math.min(Math.max(transform.y, highest), lowest) };
};
