import { afterEach, describe, expect, it } from "vitest";

import { visitorId } from "./popularity";

describe("visitorId", () => {
  afterEach(() => localStorage.clear());

  it("keeps one id for this browser", () => {
    const first = visitorId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(visitorId()).toBe(first);
  });

  it("replaces a stored nil id, which the API refuses", () => {
    localStorage.setItem("songfolio.visitor", "00000000-0000-0000-0000-000000000000");
    expect(visitorId()).not.toBe("00000000-0000-0000-0000-000000000000");
  });
});
