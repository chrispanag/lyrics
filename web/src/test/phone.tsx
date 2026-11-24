import type { Decorator } from "@storybook/react-vite";
import { expect } from "storybook/test";

/*
 * A phone for stories that check a narrow layout: the width, and the size of a
 * row there.
 */

/** The test id of the frame `phoneWidth` draws, for a play that measures it. */
export const PHONE_FRAME = "phone";

/** Sets the story in a frame as wide as a phone's screen (an iPhone's 390px). */
export const phoneWidth: Decorator = (Story) => (
  <div data-testid={PHONE_FRAME} className="w-[390px]">
    <Story />
  </div>
);

/**
 * Checks that each row is one a thumb can hit, 44px being the touch-target
 * floor, and still compact enough for ten to a screen. Returns their boxes.
 */
export async function expectCompactRows(rows: Element[]): Promise<DOMRect[]> {
  const boxes = rows.map((row) => row.getBoundingClientRect());
  for (const box of boxes) {
    await expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(box.height).toBeLessThanOrEqual(68);
  }
  return boxes;
}
