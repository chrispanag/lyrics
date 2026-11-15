import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, setTokenProvider } from "@/api/client";
import { API } from "@/test/handlers";
import { server } from "@/test/server";

// The real client contacts a live session domain. The stub answers `refresh()`
// like a restored session.
vi.mock("@prelude.so/js-sdk/session", () => ({
  PrldSessionClient: class {
    invalidated = 0;
    async invalidateCache() {
      this.invalidated += 1;
    }
    async refresh() {
      return { user: { accessToken: `token-${this.invalidated}` } };
    }
  },
}));

afterEach(() => {
  setTokenProvider(async () => null);
});

describe("auth/session", () => {
  // Registering from an effect is too late: child queries fetch first, as a
  // guest. Importing the module must be the whole registration — no React here.
  it("registers the token provider at import time", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}/api/v1/me`, ({ request }) => {
        seen.push(request.headers.get("Authorization"));
        return HttpResponse.json({ id: "user-1" });
      }),
    );

    // Nothing has registered yet, so this is the module default talking.
    await apiFetch("/api/v1/me");
    expect(seen).toEqual([null]);

    await import("./session");

    await apiFetch("/api/v1/me");
    expect(seen).toEqual([null, "Bearer token-0"]);
  });

  // A 401 retry's forceRefresh must reach the SDK, or it resends the dead token.
  it("drops the SDK's cached token before a forced refresh", async () => {
    const { getAccessToken } = await import("./session");

    expect(await getAccessToken()).toBe("token-0");
    expect(await getAccessToken(true)).toBe("token-1");
  });

  it("reports no token rather than throwing when there is no session", async () => {
    const { getAccessToken, sessionClient } = await import("./session");
    vi.spyOn(sessionClient, "refresh").mockRejectedValueOnce(new Error("no session"));

    expect(await getAccessToken()).toBeNull();
  });
});
