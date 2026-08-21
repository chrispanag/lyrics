import { describe, expect, it } from "vitest";

import { startsClearOfEdges, swipeDirection } from "./swipe";

/** A phone's width, so the numbers below read as a real screen. */
const SCREEN = 390;

describe("startsClearOfEdges", () => {
  it("takes a touch that starts in the middle of the screen", () => {
    expect(startsClearOfEdges(SCREEN / 2, SCREEN)).toBe(true);
  });

  // Both edges belong to the browser: the left is back and the right is forward
  // in Safari, and Android's back gesture comes in from either. A swipe read
  // there would page the list and leave the page in one movement.
  it("leaves a touch that starts at either edge to the browser", () => {
    expect(startsClearOfEdges(0, SCREEN)).toBe(false);
    expect(startsClearOfEdges(12, SCREEN)).toBe(false);
    expect(startsClearOfEdges(SCREEN, SCREEN)).toBe(false);
    expect(startsClearOfEdges(SCREEN - 12, SCREEN)).toBe(false);
  });

  // The width of the guard, which is the guard: Safari's own edge gesture
  // reaches in about 30px, so a value that drifts under that reads a system
  // swipe as a page turn — and one that grows past a thumb's width starts
  // refusing swipes made near, but not at, the edge. Without this the number is
  // free to move: every case above still passes with the guard at 13.
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

  // Where "too short" begins, for the same reason the edge guard has a case: a
  // travel that drifts down reintroduces exactly what this gesture replaced the
  // tap strips to be rid of — at 45px the short drag a press carries with it
  // pages the song — while one that climbs past a comfortable thumb refuses
  // swipes that were plainly meant. Without this the number is free to move:
  // every case either side of it passes with the travel at 45.
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

  // Where the line between the two actually sits, for the same reason the edge
  // guard has a case: loosen the rule to 1 and a diagonal drag pages the song,
  // tighten it to 3 and a swipe made while a thumb travels naturally up the page
  // stops working. Neither shows up in the cases either side of it.
  it("draws the line between a swipe and a scroll at twice as far across", () => {
    expect(swipeDirection(-100, 100, 200)).toBeNull();
    expect(swipeDirection(-100, 49, 200)).toBe("next");
  });

  // A finger resting on the lyrics and wandering before it lifts.
  it("ignores a movement that took too long to be a flick", () => {
    expect(swipeDirection(-200, 0, 4000)).toBeNull();
  });

  // Where that stops being a flick, pinned from both sides like the rest: a cap
  // that drifts up is the resting finger above going unnoticed — at 3000ms it
  // pages the song on the way up — and one that drifts down refuses the
  // deliberate, unhurried swipe someone reading one-handed actually makes.
  // Every case either side of it passes with the cap at 3000.
  it("draws the line between a flick and a finger that lingered at 800ms", () => {
    expect(swipeDirection(-200, 0, 800)).toBe("next");
    expect(swipeDirection(-200, 0, 801)).toBeNull();
  });
});
