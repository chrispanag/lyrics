import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PrldSessionClient } from "@prelude.so/js-sdk/session";
import { useQueryClient } from "@tanstack/react-query";

import { apiFetch, configureApi } from "@/api/client";
import { AuthContext, type AuthContextValue } from "./context";
import type { User } from "@/lib/types";

const APP_ID = import.meta.env.VITE_PRELUDE_APP_ID ?? "";
// Optional. The SDK key is a publishable client identifier, not a secret — it
// is safe in the bundle, unlike the Management API key, which must stay
// server-side.
const SDK_KEY = import.meta.env.VITE_PRELUDE_SDK_KEY ?? "";

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
 * Owns the Prelude session and exposes the local user.
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

  // The SDK client owns session storage and token refresh; it is created once
  // and never re-created, since a second instance would keep its own cache.
  const clientRef = useRef<PrldSessionClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new PrldSessionClient({
      domain: `${APP_ID}.session.prelude.dev`,
      ...(SDK_KEY ? { sdkKey: SDK_KEY } : {}),
    });
  }
  const client = clientRef.current;

  /**
   * Returns the current access token.
   *
   * `refresh()` is served from the SDK's cache when the token is still valid,
   * so calling it per request is cheap. Tokens are never copied into
   * application state or storage — the SDK is the single owner.
   */
  const getToken = useCallback(
    async (forceRefresh?: boolean): Promise<string | null> => {
      try {
        if (forceRefresh) {
          await client.invalidateCache();
        }
        const { user: session } = await client.refresh();
        return session?.accessToken ?? null;
      } catch {
        // No session, or the refresh token has been revoked.
        return null;
      }
    },
    [client],
  );

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

  // Register the token provider before anything can issue a request.
  useEffect(() => {
    configureApi({
      tokenProvider: getToken,
      onUnauthorized: () => {
        setUser(null);
        // Same cleanup as an explicit sign-out. A revoked or expired session
        // otherwise left the previous user's lists and list memberships in the
        // cache, and the next sign-in only *invalidates* — which keeps stale
        // data on screen while it refetches, showing one user another's lists.
        queryClient.clear();
      },
    });
  }, [getToken, queryClient]);

  // Restore an existing session on first paint.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = await getToken();
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
  }, [getToken, loadProfile]);

  const login = useCallback(
    async (email: string, password: string) => {
      await client.loginWithPassword({ identifier: email, password });
      // The cache still holds the signed-out state until it is dropped.
      await client.invalidateCache();

      const profile = await loadProfile();
      setUser(profile);
      // Cached responses were fetched as a guest and may now differ.
      await queryClient.invalidateQueries();
    },
    [client, loadProfile, queryClient],
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
      await client.logout();
    } finally {
      // Clear local state even if the revocation call failed, so the user is
      // not left looking at a signed-in UI they cannot use.
      setUser(null);
      queryClient.clear();
    }
  }, [client, queryClient]);

  const validatePassword = useCallback(
    async (password: string) => {
      try {
        const result = await client.validatePassword(password);
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
    [client],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, register, login, logout, reload, validatePassword }),
    [user, loading, register, login, logout, reload, validatePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
