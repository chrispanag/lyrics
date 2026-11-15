import { describe, expect, it, vi } from "vitest";

describe("the shared MSW server", () => {
  // An unstubbed request has to fail the spec that made it — see the
  // `server.listen` call in vitest.setup.ts. tsc catches a misspelled key
  // there, but not a strategy that type-checks and does not fail: "warn" or
  // "bypass" leave every spec green, and this is the one that would notice.
  // The spy is what tells them apart, since a fetch to a port nothing listens
  // on rejects under "bypass" too.
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
