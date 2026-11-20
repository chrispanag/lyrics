// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiUrl } from "./client";

afterEach(() => vi.unstubAllEnvs());

describe("apiUrl on the server", () => {
  it("reads API_ORIGIN when the request is made, and drops a trailing slash", () => {
    vi.stubEnv("API_ORIGIN", "http://api:8080/");

    expect(apiUrl("/api/v1/songs")).toBe("http://api:8080/api/v1/songs");
  });

  it("falls back to the local API when API_ORIGIN is unset", () => {
    vi.stubEnv("API_ORIGIN", "");

    expect(apiUrl("/api/v1/health")).toBe("http://localhost:8080/api/v1/health");
  });
});
