import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, setTokenProvider } from "@/api/client";
import { API } from "@/test/handlers";
import { server } from "@/test/server";

// The real client would reach for a live session domain on construction. The
// stub answers `refresh()` the way a restored session does, which is all this
// module needs from it.
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
  /*
   * The bug this pins: registering the token provider from an effect in
   * AuthProvider is too late. React flushes child effects before parent ones,
   * so a query mounted under the provider fetches first, gets the module
   * default, and is answered as a guest — a private list 404ing to its owner,
   * with no 401 for the client to retry. Importing the module has to be the
   * whole registration, which is what this asserts: no React here at all.
   */
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

  // A 401 retry passes forceRefresh through, and it has to reach the SDK — a
  // retry that resends the cached token asks the same dead question twice.
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
