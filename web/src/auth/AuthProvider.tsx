import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiFetch, setUnauthorizedHandler } from "@/api/client";
import { AuthContext, type AuthContextValue } from "./context";
import { getAccessToken, sessionClient } from "./session";
import type { User } from "@/lib/types";

/**
 * Turns a failed compliancy check into a sentence.
 *
 * Prelude reports rules as `{ criteria, expected, actual }` with no prose, and
 * the set of criteria is configured per application — so unknown criteria fall
 * back to a generic phrasing rather than rendering a raw identifier.
 */
function describeCompliancy(result: { criteria: string; expected: number }): string {
  const { criteria, expected } = result;
  switch (criteria) {
    case "min_length":
      return `Use at least ${expected} characters.`;
    case "max_length":
      return `Use at most ${expected} characters.`;
    case "min_uppercase":
      return `Include at least ${expected} uppercase letter${expected === 1 ? "" : "s"}.`;
    case "min_lowercase":
      return `Include at least ${expected} lowercase letter${expected === 1 ? "" : "s"}.`;
    case "min_digits":
      return `Include at least ${expected} number${expected === 1 ? "" : "s"}.`;
    case "min_symbols":
      return `Include at least ${expected} symbol${expected === 1 ? "" : "s"}.`;
    default:
      return `Does not meet the ${criteria.replace(/_/g, " ")} requirement.`;
  }
}

/**
 * Drives the Prelude session and exposes the local user.
 *
 * The session itself lives in `./session`, outside React, because the API
 * client needs a token before the first effect runs. What is left here is the
 * part that genuinely is state: who is signed in, and whether we know yet.
 *
 * Authentication is split across two systems by design: Prelude holds
 * credentials and issues access tokens directly to the browser, while our API
 * holds the role. Registration is the exception — the browser SDK can only log
 * in, so creating an account goes through our backend, which has the
 * Management API key.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const loadProfile = useCallback(async (): Promise<User | null> => {
    try {
      return await apiFetch<User>("/api/v1/me");
    } catch {
      return null;
    }
  }, []);

  const reload = useCallback(
    async (next?: User) => {
      setUser(next ?? (await loadProfile()));
    },
    [loadProfile],
  );

  // Only the reaction to a dead session is registered here — the token
  // provider itself is registered by `./session` at import time, so that a
  // query mounted under this provider cannot fetch before it exists. An effect
  // is soon enough for this half: it needs React state, and no response can
  // come back with a 401 before the first effects have flushed.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      // Same cleanup as an explicit sign-out. A revoked or expired session
      // otherwise left the previous user's lists and list memberships in the
      // cache, and the next sign-in only *invalidates* — which keeps stale
      // data on screen while it refetches, showing one user another's lists.
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  // Restore an existing session on first paint.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getAccessToken();
      if (cancelled) return;

      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      const profile = await loadProfile();
      if (cancelled) return;

      setUser(profile);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const login = useCallback(
    async (email: string, password: string) => {
      await sessionClient.loginWithPassword({ identifier: email, password });
      // The cache still holds the signed-out state until it is dropped.
      await sessionClient.invalidateCache();

      const profile = await loadProfile();
      setUser(profile);
      // Cached responses were fetched as a guest and may now differ.
      await queryClient.invalidateQueries();
    },
    [loadProfile, queryClient],
  );

  const register = useCallback(
    async ({
      email,
      password,
      displayName,
    }: {
      email: string;
      password: string;
      displayName?: string;
    }) => {
      // Our API creates the Prelude account; the SDK cannot.
      await apiFetch<User>("/api/v1/auth/register", {
        method: "POST",
        anonymous: true,
        body: {
          email,
          password,
          display_name: displayName?.trim() ? displayName.trim() : null,
        },
      });
      // Signing in immediately is what makes registration feel like one step.
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await sessionClient.logout();
    } finally {
      // Clear local state even if the revocation call failed, so the user is
      // not left looking at a signed-in UI they cannot use.
      setUser(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const validatePassword = useCallback(
    async (password: string) => {
      try {
        const result = await sessionClient.validatePassword(password);
        const messages = (result?.results ?? [])
          .filter((r) => !r.valid)
          .map(describeCompliancy);
        return { valid: result?.valid ?? true, messages };
      } catch {
        // The rules live in Prelude; if they cannot be fetched, let the server
        // be the judge rather than blocking the user on a guess.
        return { valid: true, messages: [] };
      }
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, register, login, logout, reload, validatePassword }),
    [user, loading, register, login, logout, reload, validatePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
