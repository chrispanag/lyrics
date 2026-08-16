import type { Modifier } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import { verticalWithinList } from "./dragBounds";

// dnd-kit declares its modifier argument inline, so the only name for it is the
// one derived from the function type. Each case supplies the fields it cares
// about and casts the rest away.
type ModifierArgs = Parameters<Modifier>[0];

/** A rect in the shape dnd-kit measures, positioned by its top edge. */
function rect(top: number, height: number) {
  return { top, bottom: top + height, left: 0, right: 300, width: 300, height };
}

/**
 * A list of three 100px rows starting at y=0, with the second row dragged by
 * `y`. The row can travel from -100 (against the top) to +100 (against the
 * bottom).
 */
function drag(y: number, x = 0) {
  return verticalWithinList({
    transform: { x, y, scaleX: 1, scaleY: 1 },
    draggingNodeRect: rect(100, 100),
    containerNodeRect: rect(0, 300),
  } as ModifierArgs);
}

describe("verticalWithinList", () => {
  it("drops sideways movement", () => {
    expect(drag(20, 150).x).toBe(0);
    expect(drag(20, -150).x).toBe(0);
  });

  it("leaves movement inside the list alone", () => {
    expect(drag(60).y).toBe(60);
    expect(drag(-60).y).toBe(-60);
  });

  it("stops the row at the top of the list", () => {
    expect(drag(-100).y).toBe(-100);
    expect(drag(-400).y).toBe(-100);
  });

  it("stops the row at the bottom of the list", () => {
    expect(drag(100).y).toBe(100);
    expect(drag(400).y).toBe(100);
  });

  // Modifiers run before the first measurement too, and a dropped rect must not
  // take the axis constraint down with it.
  it("still pins the axis when nothing has been measured", () => {
    const unmeasured = verticalWithinList({
      transform: { x: 80, y: 40, scaleX: 1, scaleY: 1 },
      draggingNodeRect: null,
      containerNodeRect: null,
    } as ModifierArgs);

    expect(unmeasured).toMatchObject({ x: 0, y: 40 });
  });
});
