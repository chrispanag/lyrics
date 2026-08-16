import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  apiFetch,
  setTokenProvider,
  setUnauthorizedHandler,
  toQuery,
} from "./client";
import { API } from "@/test/handlers";
import { server } from "@/test/server";

afterEach(() => {
  // Both, every time. The registrations are module state, so a handler left
  // behind by one test fires during another — and since only one test asserts
  // on it, the leak would show up as a passing suite.
  setTokenProvider(async () => null);
  setUnauthorizedHandler(null);
});

describe("apiFetch", () => {
  it("attaches the bearer token", async () => {
    setTokenProvider(async () => "token-abc");

    let seen: string | null = null;
    server.use(
      http.get(`${API}/api/v1/me`, ({ request }) => {
        seen = request.headers.get("Authorization");
        return HttpResponse.json({ id: "user-1" });
      }),
    );

    await apiFetch("/api/v1/me");
    expect(seen).toBe("Bearer token-abc");
  });

  it("omits the header for anonymous requests even when signed in", async () => {
    setTokenProvider(async () => "token-abc");

    let seen: string | null = "unset";
    server.use(
      http.post(`${API}/api/v1/auth/register`, ({ request }) => {
        seen = request.headers.get("Authorization");
        return HttpResponse.json({ id: "user-1" }, { status: 201 });
      }),
    );

    await apiFetch("/api/v1/auth/register", { method: "POST", anonymous: true, body: {} });
    expect(seen).toBeNull();
  });

  /*
   * Access tokens are short-lived, so expiry mid-session is routine rather than
   * exceptional. It has to be invisible: bouncing the user to a login screen
   * because a token aged out would look like being randomly signed out.
   */
  it("refreshes once and retries after a 401", async () => {
    const tokenProvider = vi
      .fn<(force?: boolean) => Promise<string | null>>()
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");

    setTokenProvider(tokenProvider);

    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}/api/v1/me`, ({ request }) => {
        const auth = request.headers.get("Authorization");
        seen.push(auth);
        if (auth === "Bearer stale-token") {
          return HttpResponse.json(
            { error: { code: "unauthorized", message: "expired" } },
            { status: 401 },
          );
        }
        return HttpResponse.json({ id: "user-1" });
      }),
    );

    const result = await apiFetch<{ id: string }>("/api/v1/me");

    expect(result.id).toBe("user-1");
    expect(seen).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
    // The retry must force a refresh, or it would resend the same stale token.
    expect(tokenProvider).toHaveBeenLastCalledWith(true);
  });

  it("gives up after one retry and reports the session as lost", async () => {
    const onUnauthorized = vi.fn();
    setTokenProvider(async () => "dead-token");
    setUnauthorizedHandler(onUnauthorized);

    let calls = 0;
    server.use(
      http.get(`${API}/api/v1/me`, () => {
        calls += 1;
        return HttpResponse.json(
          { error: { code: "unauthorized", message: "nope" } },
          { status: 401 },
        );
      }),
    );

    await expect(apiFetch("/api/v1/me")).rejects.toThrow(ApiError);
    expect(calls).toBe(2);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("surfaces the structured error body", async () => {
    server.use(
      http.post(`${API}/api/v1/songs`, () =>
        HttpResponse.json(
          {
            error: {
              code: "validation_failed",
              message: "The song could not be saved.",
              details: { title: "Title is required." },
            },
          },
          { status: 422 },
        ),
      ),
    );

    const error: unknown = await apiFetch("/api/v1/songs", {
      method: "POST",
      body: {},
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    // Narrowed rather than cast, so the assertions below are type-checked.
    if (!(error instanceof ApiError)) throw error;

    expect(error.status).toBe(422);
    expect(error.isValidation).toBe(true);
    expect(error.details.title).toBe("Title is required.");
  });

  it("handles a 204 with no body", async () => {
    server.use(http.delete(`${API}/api/v1/songs/1`, () => new HttpResponse(null, { status: 204 })));

    await expect(apiFetch("/api/v1/songs/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("does not retry a 403, which a fresh token would not fix", async () => {
    let calls = 0;
    setTokenProvider(async () => "token");
    server.use(
      http.post(`${API}/api/v1/songs`, () => {
        calls += 1;
        return HttpResponse.json(
          { error: { code: "forbidden", message: "Not allowed." } },
          { status: 403 },
        );
      }),
    );

    await expect(apiFetch("/api/v1/songs", { method: "POST", body: {} })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("toQuery", () => {
  it("drops empty values", () => {
    expect(toQuery({ q: "abc", genre: "", limit: 20, offset: undefined, page: null })).toBe(
      "?q=abc&limit=20",
    );
  });

  it("returns an empty string when nothing is set", () => {
    expect(toQuery({ q: "", limit: undefined })).toBe("");
  });

  it("encodes non-ASCII queries", () => {
    expect(toQuery({ q: "θάλασσα" })).toContain("q=%CE%B8");
  });
});
