import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, setTokenProvider } from "@/api/client";
import { API, makeUser } from "@/test/handlers";
import { server } from "@/test/server";
import { storeUser } from "./storedUser";

// The real client contacts a live session domain. The stub answers `refresh()`
// like a restored session, and counts how many were built and refreshed.
const sdk = vi.hoisted(() => ({ built: 0, failNext: false, refreshes: 0 }));

vi.mock("@prelude.so/js-sdk/session", () => ({
  PrldSessionClient: class {
    constructor() {
      sdk.built += 1;
      if (sdk.failNext) {
        sdk.failNext = false;
        throw new Error("construction failed");
      }
    }
    invalidated = 0;
    async invalidateCache() {
      this.invalidated += 1;
    }
    async refresh() {
      sdk.refreshes += 1;
      return { user: { accessToken: `token-${this.invalidated}` } };
    }
  },
}));

const HINT = "lyrics:session";

/** An SDK error as the session domain's 401 throws it. */
function unauthorized(): Error {
  const error = new Error("Unauthorized");
  error.name = "UnauthorizedError";
  return error;
}

// Every spec but the guest's has signed in on this browser before.
beforeEach(() => {
  localStorage.setItem(HINT, "");
  sdk.refreshes = 0;
});

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
    // Registered, but nothing built yet: a server imports this too.
    expect(sdk.built).toBe(0);

    await apiFetch("/api/v1/me");
    expect(seen).toEqual([null, "Bearer token-0"]);
  });

  // Two clients would disagree about the session.
  it("builds one SDK client however often it is asked for", async () => {
    const { sessionClient } = await import("./session");

    expect(await sessionClient()).toBe(await sessionClient());
  });

  // A 401 retry's forceRefresh must reach the SDK, or it resends the dead token.
  it("drops the SDK's cached token before a forced refresh", async () => {
    const { getAccessToken } = await import("./session");

    expect(await getAccessToken()).toBe("token-0");
    expect(await getAccessToken(true)).toBe("token-1");
  });

  // A kept rejection would refuse every later call for the life of the page.
  it("builds the client again after a failed construction", async () => {
    vi.resetModules();
    const { sessionClient } = await import("./session");
    sdk.failNext = true;

    await expect(sessionClient()).rejects.toThrow("construction failed");
    await expect(sessionClient()).resolves.toBeDefined();
  });

  // Not a guest: read as one, a signed-in visitor would lose their session.
  it("fails the token rather than reporting no session when the SDK cannot load", async () => {
    vi.resetModules();
    const { getAccessToken } = await import("./session");
    sdk.failNext = true;

    await expect(getAccessToken()).rejects.toThrow("construction failed");
    expect(await getAccessToken()).toBe("token-0");
  });

  it("reports no token rather than throwing when there is no session", async () => {
    const { getAccessToken, sessionClient } = await import("./session");
    vi.spyOn(await sessionClient(), "refresh").mockRejectedValueOnce(new Error("no session"));

    expect(await getAccessToken()).toBeNull();
  });

  // A guest's refresh is a 401 the browser logs on every page.
  it("answers a guest without asking the session domain", async () => {
    const { getAccessToken } = await import("./session");
    localStorage.removeItem(HINT);

    expect(await getAccessToken()).toBeNull();
    expect(await getAccessToken(true)).toBeNull();
    expect(sdk.refreshes).toBe(0);
  });

  it("forgets the session once the session domain refuses it", async () => {
    const { getAccessToken, sessionClient } = await import("./session");
    vi.spyOn(await sessionClient(), "refresh").mockRejectedValueOnce(unauthorized());

    expect(await getAccessToken()).toBeNull();
    expect(localStorage.getItem(HINT)).toBeNull();
  });

  // Read as signed out for good, a dropped connection would end the session.
  it("keeps the session through a failure that is not a refusal", async () => {
    const { getAccessToken, sessionClient } = await import("./session");
    vi.spyOn(await sessionClient(), "refresh").mockRejectedValueOnce(new TypeError("offline"));

    expect(await getAccessToken()).toBeNull();
    expect(await getAccessToken()).not.toBeNull();
  });

  // Signed in before the hint shipped: only the profile snapshot says so.
  it("takes a profile snapshot as a session to restore", async () => {
    vi.resetModules();
    localStorage.removeItem(HINT);
    storeUser(makeUser());

    const { getAccessToken } = await import("./session");

    expect(await getAccessToken()).not.toBeNull();
  });

  it("records a session opened and closed", async () => {
    const { markSession } = await import("./session");

    markSession(false);
    expect(localStorage.getItem(HINT)).toBeNull();
    markSession(true);
    expect(localStorage.getItem(HINT)).not.toBeNull();
  });
});
