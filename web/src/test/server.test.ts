import { describe, expect, it, vi } from "vitest";

describe("the shared MSW server", () => {
  // tsc catches a misspelled `server.listen` option; nothing else catches a
  // strategy that type-checks and lets requests through. The spy is what tells
  // "error" from "bypass", since a fetch to a closed port rejects under both.
  it("refuses a request no handler answers", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(fetch("http://localhost:8080/api/v1/nothing-answers-this")).rejects.toThrow();
      expect(report).toHaveBeenCalled();
    } finally {
      report.mockRestore();
    }
  });
});
