function fixedRect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 300,
    width: 300,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Lays out every `ul` in a container as a stack of equal rows, since dnd-kit
 * needs real rectangles and jsdom has none. The list is sized too: it bounds
 * the drag. Call again after a drag, as the rects stay with the moved nodes.
 */
export function stubRowRects(container: HTMLElement, height = 100): void {
  container.querySelectorAll("ul").forEach((list) => {
    const rows = list.querySelectorAll("li");
    rows.forEach((row, index) => {
      const rect = fixedRect(index * height, height);
      row.getBoundingClientRect = () => rect;
    });

    const listRect = fixedRect(0, rows.length * height);
    list.getBoundingClientRect = () => listRect;
  });
}
