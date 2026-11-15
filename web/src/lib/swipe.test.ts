import { describe, expect, it } from "vitest";

import { startsClearOfEdges, swipeDirection } from "./swipe";

/** A phone's width, so the numbers below read as a real screen. */
const SCREEN = 390;

describe("startsClearOfEdges", () => {
  it("takes a touch that starts in the middle of the screen", () => {
    expect(startsClearOfEdges(SCREEN / 2, SCREEN)).toBe(true);
  });

  // Both edges belong to the browser's own back/forward gestures.
  it("leaves a touch that starts at either edge to the browser", () => {
    expect(startsClearOfEdges(0, SCREEN)).toBe(false);
    expect(startsClearOfEdges(12, SCREEN)).toBe(false);
    expect(startsClearOfEdges(SCREEN, SCREEN)).toBe(false);
    expect(startsClearOfEdges(SCREEN - 12, SCREEN)).toBe(false);
  });

  // Pins the guard from both sides: wider than Safari's ~30px edge gesture,
  // narrower than a thumb.
  it("stays wider than the browser's own edge gesture, and no wider than a thumb", () => {
    expect(startsClearOfEdges(30, SCREEN)).toBe(false);
    expect(startsClearOfEdges(44, SCREEN)).toBe(true);
    expect(startsClearOfEdges(SCREEN - 44, SCREEN)).toBe(true);
    expect(startsClearOfEdges(SCREEN - 30, SCREEN)).toBe(false);
  });
});

describe("swipeDirection", () => {
  it("reads a flick left as the next song and right as the previous one", () => {
    expect(swipeDirection(-120, 4, 180)).toBe("next");
    expect(swipeDirection(120, -4, 180)).toBe("previous");
  });

  it("ignores a movement too short to be meant", () => {
    expect(swipeDirection(-40, 0, 120)).toBeNull();
  });

  // Pins the travel: too low and a press's drag pages the song, too high and
  // real swipes are refused.
  it("draws the line between a drag and a swipe at 60px across", () => {
    expect(swipeDirection(-59, 0, 200)).toBeNull();
    expect(swipeDirection(-60, 0, 200)).toBe("next");
  });

  // Reading is vertical scrolling, which is this gesture with the axes swapped.
  it("ignores a drag that went mostly up or down", () => {
    expect(swipeDirection(-80, 60, 200)).toBeNull();
    expect(swipeDirection(80, -200, 300)).toBeNull();
  });

  it("still reads a swipe that drifted a little off the axis", () => {
    expect(swipeDirection(-100, 30, 200)).toBe("next");
  });

  // Pins the ratio: looser pages on a diagonal drag, tighter refuses a natural
  // thumb swipe.
  it("draws the line between a swipe and a scroll at twice as far across", () => {
    expect(swipeDirection(-100, 100, 200)).toBeNull();
    expect(swipeDirection(-100, 49, 200)).toBe("next");
  });

  // A finger resting on the lyrics and wandering before it lifts.
  it("ignores a movement that took too long to be a flick", () => {
    expect(swipeDirection(-200, 0, 4000)).toBeNull();
  });

  // Pins the cap: higher lets a resting finger page the song, lower refuses an
  // unhurried one-handed swipe.
  it("draws the line between a flick and a finger that lingered at 800ms", () => {
    expect(swipeDirection(-200, 0, 800)).toBe("next");
    expect(swipeDirection(-200, 0, 801)).toBeNull();
  });
});
