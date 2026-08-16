import { describe, expect, it } from "vitest";

import { move } from "./reorder";

describe("move", () => {
  it("moves an item down to the dropped-on position", () => {
    expect(move(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item up to the dropped-on position", () => {
    expect(move(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the rest of the order alone", () => {
    expect(move(["a", "b", "c", "d", "e"], "b", "c")).toEqual(["a", "c", "b", "d", "e"]);
  });

  // Returning the same array, not a copy, is what lets a drop that changed
  // nothing skip the request — the caller compares by identity.
  it("returns the original array when nothing moves", () => {
    const items = ["a", "b", "c"];
    expect(move(items, "b", "b")).toBe(items);
    expect(move(items, "b", "gone")).toBe(items);
    expect(move(items, "gone", "b")).toBe(items);
  });

  it("does not mutate its input", () => {
    const items = ["a", "b", "c"];
    move(items, "a", "c");
    expect(items).toEqual(["a", "b", "c"]);
  });
});
