import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiFetch, setUnauthorizedHandler } from "@/api/client";
import {
  AuthContext,
  PASSWORD_CHANGE_UNAVAILABLE_ERROR,
  RESET_UNCONFIGURED_ERROR,
  namedError,
  type AuthContextValue,
} from "./context";
import { OTP_LOGIN_CONFIG_ID, getAccessToken, sessionClient } from "./session";
import { storeUser, storedUser } from "./storedUser";
import type { User } from "@/lib/types";

/**
 * The step-up scope that proves an address. Must match the Prelude application
 * config and `EmailVerifyScope` (Go).
 */
const EMAIL_VERIFY_SCOPE = "email:verify";

/**
 * Prelude's reserved scope for writing a password. One config entry serves both
 * reset and change-password, so it is set for the stricter (a code); see
 * CLAUDE.md, "Password reset".
 */
const PASSWORD_WRITE_SCOPE = "prld:pwd:write";

/**
 * Turns a failed compliancy check into a sentence. Criteria are configured per
 * application, so unknown ones get a generic phrasing.
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
 * Drives the Prelude session and exposes the local user. The session client
 * lives in `./session`, outside React, so a token exists before the first effect.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Seeded from the last session's snapshot (./storedUser) to avoid a guest
  // flash. `loading` still means nothing is known; every redirect reads it.
  const [user, setUser] = useState<User | null>(storedUser);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // The open challenge per scope. Keyed by scope so no flow can reuse another's
  // challenge; reusing its own keeps a remount from retiring the emailed code.
  const challenges = useRef<Record<string, string | null>>({});

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

  // The token provider is registered by `./session` at import time, never
  // here. This handler needs React state, and no 401 can arrive before effects.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      // Same cleanup as `logout`: otherwise the next user sees the last one's
      // cached lists while refetching.
      queryClient.clear();
      // A leftover challenge would show the next user a code form for a code
      // nobody sent them.
      challenges.current = {};
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

  // One effect, not a write per call site: a forgotten site would remember an
  // account that has signed out.
  useEffect(() => {
    storeUser(user);
  }, [user]);

  // Everything after Prelude mints a session, whichever credential opened it
  // (password reset's code included); skipping a step leaves it half signed in.
  const completeSignIn = useCallback(async () => {
    // The cache still holds the signed-out state until it is dropped.
    await sessionClient.invalidateCache();

    const profile = await loadProfile();
    setUser(profile);
    // Cached responses were fetched as a guest and may now differ.
    await queryClient.invalidateQueries();
  }, [loadProfile, queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      await sessionClient.loginWithPassword({ identifier: email, password });
      await completeSignIn();
    },
    [completeSignIn],
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
      // Signed in but unverified: the server refuses most routes until the code.
      await login(email, password);
    },
    [login],
  );

  // Tells our API to read the granted scope off the token and mark the account
  // verified.
  const recordVerification = useCallback(async () => {
    // Forced refresh: a cached token may predate the grant and get a 403.
    await getAccessToken(true);
    setUser(await apiFetch<User>("/api/v1/auth/verify-email", { method: "POST" }));
  }, []);

  /**
   * Requests a step-up for a scope and has Prelude send the code it asks for.
   *
   * Remembers the challenge under its scope. `continue` (granted outright,
   * nothing emailed) is returned for each caller to interpret; `block` throws.
   */
  const openStepUp = useCallback(async (scope: string) => {
    // Local to this call, so a leftover id in the record cannot stand in for a
    // challenge this call never got. An object, since TypeScript infers a `let`
    // assigned only in a callback as `never`.
    const opened: { id: string | null } = { id: null };

    const { status } = await sessionClient.requestStepUp({
      scope,
      onChallenge: (info) => {
        opened.id = info.challengeId;
      },
    });

    if (status === "continue") {
      // Nothing to answer, so nothing may be left claiming otherwise.
      challenges.current[scope] = null;
      return status;
    }
    if (status === "block") {
      throw new Error(`Prelude refused the "${scope}" step-up.`);
    }
    if (!opened.id) {
      throw new Error(`Prelude opened no "${scope}" challenge.`);
    }

    challenges.current[scope] = opened.id;
    await sessionClient.startOTP({ challengeId: opened.id });
    return status;
  }, []);

  const startEmailVerification = useCallback(async () => {
    // A second challenge would retire the code already in the inbox.
    if (challenges.current[EMAIL_VERIFY_SCOPE]) return;

    // Granted outright: nothing to type, so record it now.
    if ((await openStepUp(EMAIL_VERIFY_SCOPE)) === "continue") {
      await recordVerification();
    }
  }, [openStepUp, recordVerification]);

  /**
   * Sends the code for a scope again, opening a fresh challenge when there is
   * none or the retry fails (an expired challenge can never be retried).
   */
  const resendCode = useCallback(async (scope: string, open: () => Promise<void>) => {
    if (challenges.current[scope]) {
      try {
        await sessionClient.retryOTP();
        return;
      } catch (caught) {
        // Logged: a Prelude outage looks identical from here.
        console.error(`The "${scope}" code could not be resent:`, caught);
        challenges.current[scope] = null;
      }
    }
    await open();
  }, []);

  const resendVerificationCode = useCallback(
    () => resendCode(EMAIL_VERIFY_SCOPE, startEmailVerification),
    [resendCode, startEmailVerification],
  );

  const verifyEmail = useCallback(
    async (code: string) => {
      const challengeId = challenges.current[EMAIL_VERIFY_SCOPE];
      if (!challengeId) {
        throw new Error("No verification is in progress.");
      }
      // A wrong code throws here. On success the SDK refreshes the session.
      await sessionClient.checkOTP({ code, challengeId });
      challenges.current[EMAIL_VERIFY_SCOPE] = null;
      await recordVerification();
    },
    [recordVerification],
  );

  // Declared before confirmPasswordResetCode, whose dependency array reads it.
  const logout = useCallback(async () => {
    try {
      await sessionClient.logout();
    } finally {
      // Clear local state even if the revocation call failed.
      setUser(null);
      queryClient.clear();
      // Every scope's challenge: a leftover would show the next user a code
      // form for a code nobody sent them.
      challenges.current = {};
    }
  }, [queryClient]);

  // The emailed code is a login (Prelude has no anonymous step-up); the write
  // is authorized by a step-up on the session it opens. See CLAUDE.md,
  // "Password reset".
  const startPasswordReset = useCallback(async (email: string) => {
    if (!OTP_LOGIN_CONFIG_ID) {
      // Named so the screen reports misconfiguration, not a Prelude outage.
      throw namedError(
        RESET_UNCONFIGURED_ERROR,
        "Password reset is unconfigured: NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID is empty.",
      );
    }
    // Drop any challenge a previous attempt ("Start over") left open.
    challenges.current[PASSWORD_WRITE_SCOPE] = null;

    await sessionClient.startOTP({
      identifier: { type: "email_address", value: email },
      loginConfigId: OTP_LOGIN_CONFIG_ID,
    });
  }, []);

  const resendPasswordResetCode = useCallback(async () => {
    await sessionClient.retryOTP();
  }, []);

  const confirmPasswordResetCode = useCallback(
    async (code: string) => {
      // A wrong code throws here as a typed SDK error.
      await sessionClient.checkOTP({ code });

      // From here the visitor is signed in and the code is spent, so any
      // failure below ends the session; the recovery is "Start over".
      try {
        await completeSignIn();

        if ((await openStepUp(PASSWORD_WRITE_SCOPE)) === "review") {
          // A second code was emailed (the shared config demands one);
          // `confirmPasswordWriteCode` answers it.
          return { secondCodeSent: true };
        }

        // Granted outright refreshes nothing; canChangePassword forces the
        // refresh, or the write 403s with nothing wrong with the password.
        if (!(await sessionClient.canChangePassword())) {
          throw new Error("The session did not receive permission to change the password.");
        }
        return { secondCodeSent: false };
      } catch (caught) {
        // Its own try, so a failed revocation cannot replace the cause.
        try {
          await logout();
        } catch {
          /* already failing; the original cause is the one worth reporting */
        }
        throw caught;
      }
    },
    [completeSignIn, logout, openStepUp],
  );

  const startPasswordChange = useCallback(async () => {
    // A second challenge would retire the code already in the inbox.
    if (challenges.current[PASSWORD_WRITE_SCOPE]) return;

    if ((await openStepUp(PASSWORD_WRITE_SCOPE)) === "continue") {
      // Refused: with no code, nothing proves more than the session (which a
      // thief would also have).
      throw namedError(
        PASSWORD_CHANGE_UNAVAILABLE_ERROR,
        `Prelude granted "${PASSWORD_WRITE_SCOPE}" with no challenge, so nothing re-proves the account.`,
      );
    }
  }, [openStepUp]);

  const confirmPasswordWriteCode = useCallback(async (code: string) => {
    const challengeId = challenges.current[PASSWORD_WRITE_SCOPE];
    if (!challengeId) {
      throw new Error("No password change is in progress.");
    }

    // Cleared after the check: a wrong code leaves the challenge open to retry.
    await sessionClient.checkOTP({ code, challengeId });
    challenges.current[PASSWORD_WRITE_SCOPE] = null;

    // Checked on a fresh token so a missing grant fails here, nameably, rather
    // than as a rejected password a step later.
    if (!(await sessionClient.canChangePassword())) {
      throw new Error("The session did not receive permission to change the password.");
    }
  }, []);

  const resendPasswordWriteCode = useCallback(
    () => resendCode(PASSWORD_WRITE_SCOPE, startPasswordChange),
    [resendCode, startPasswordChange],
  );

  const changePassword = useCallback(async (password: string) => {
    await sessionClient.changePassword(password);
    // Nothing local to reload: the password lives in Prelude.
  }, []);

  const signOutOtherDevices = useCallback(async () => {
    await sessionClient.revokeSessions("others");
  }, []);

  const validatePassword = useCallback(
    async (password: string) => {
      try {
        const result = await sessionClient.validatePassword(password);
        const messages = (result?.results ?? [])
          .filter((r) => !r.valid)
          .map(describeCompliancy);
        return { valid: result?.valid ?? true, messages };
      } catch {
        // Rules unavailable: let the server judge.
        return { valid: true, messages: [] };
      }
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      register,
      login,
      logout,
      reload,
      validatePassword,
      startEmailVerification,
      verifyEmail,
      resendVerificationCode,
      startPasswordReset,
      resendPasswordResetCode,
      confirmPasswordResetCode,
      startPasswordChange,
      confirmPasswordWriteCode,
      resendPasswordWriteCode,
      changePassword,
      signOutOtherDevices,
    }),
    [
      user,
      loading,
      register,
      login,
      logout,
      reload,
      validatePassword,
      startEmailVerification,
      verifyEmail,
      resendVerificationCode,
      startPasswordReset,
      resendPasswordResetCode,
      confirmPasswordResetCode,
      startPasswordChange,
      confirmPasswordWriteCode,
      resendPasswordWriteCode,
      changePassword,
      signOutOtherDevices,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
