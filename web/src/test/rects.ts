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
 * Lays out every `ul` in a container as a stack of equal rows.
 *
 * jsdom reports every element as a zero-sized box at the origin, and dnd-kit
 * decides both what a drag is over and how far it may travel by comparing
 * rectangles — so without this a keyboard drag lifts a row and finds nowhere to
 * put it. The list itself is measured as well as its rows: it is the bound the
 * drag is clamped to, and left at zero height it pins every row in place.
 *
 * Shared by every spec that drives a sortable list, so they cannot disagree
 * about the geometry. Call it again after a drag — the rects are pinned to
 * nodes that reordering has since moved, where a browser would re-read layout.
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
