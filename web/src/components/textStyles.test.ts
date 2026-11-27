import { describe, expect, it } from "vitest";

import { linkClasses } from "./textStyles";

describe("linkClasses", () => {
  it("sets each tone apart", () => {
    expect(linkClasses("accent")).toContain("text-fg-accent");
    expect(linkClasses("muted")).toContain("font-medium");
    expect(linkClasses("quiet")).not.toContain("font-medium");
  });

  // A button drawn as a link must look disabled when it is.
  it("draws a disabled button as disabled in every tone", () => {
    for (const tone of ["accent", "muted", "quiet"] as const) {
      expect(linkClasses(tone)).toContain("disabled:no-underline");
    }
  });
});
