import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiFetch, setUnauthorizedHandler } from "@/api/client";
import { AuthContext, RESET_UNCONFIGURED_ERROR, type AuthContextValue } from "./context";
import { OTP_LOGIN_CONFIG_ID, getAccessToken, sessionClient } from "./session";
import type { User } from "@/lib/types";

/**
 * The step-up scope that proves an address.
 *
 * It names a scope configured on the Prelude application, and the Go API checks
 * for the same string on the access token — three places that have to agree,
 * and only the two ends of the request can be kept in step from here.
 */
const EMAIL_VERIFY_SCOPE = "email:verify";

/**
 * The step-up scope that permits writing a new password.
 *
 * Prelude's own reserved scope rather than one of ours, so unlike
 * EMAIL_VERIFY_SCOPE it is not named in three places: no configuration invents
 * it and our API never reads it. Prelude grants it, and consumes it as the
 * password is written, so it cannot be spent twice.
 */
const PASSWORD_WRITE_SCOPE = "prld:pwd:write";

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

  // Everything that has to happen once Prelude has minted a session, whichever
  // credential opened it. Password reset shares this: its emailed code is a
  // login, and a flow that skipped any of these steps would leave the app half
  // signed in — a token for the new user, a profile and a query cache still
  // belonging to whoever was here before.
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
      // Signing in immediately is what makes registration feel like one step.
      // The account is signed in but unverified at this point: the server
      // answers everything but the profile and the verification endpoints with
      // a 403 until the emailed code is entered.
      await login(email, password);
    },
    [login],
  );

  // Tells our API to read the granted scope off the access token and write the
  // account down as verified. Nothing to invalidate afterwards, unlike login:
  // an unverified account is held on the verification screen, so nothing it was
  // refused ever reached a query — and a query that did fail refetches when its
  // page mounts.
  const recordVerification = useCallback(async () => {
    // Forced refresh first. The grant sits on the session for ten minutes, so a
    // newly issued token still carries it, and this removes the one way the
    // request could arrive without it: a cached token minted before the
    // challenge completed, which the API would answer with a 403 the user
    // cannot act on.
    await getAccessToken(true);
    setUser(await apiFetch<User>("/api/v1/auth/verify-email", { method: "POST" }));
  }, []);

  // The id of the open verification challenge. A ref rather than state: it is
  // needed by the next call, not by the render, and re-rendering the code form
  // on a value the user never sees would be noise.
  const challengeID = useRef<string | null>(null);

  const startEmailVerification = useCallback(async () => {
    // Reusing an open challenge matters: starting a second one retires the
    // first, so a remount would invalidate the code already sitting in the
    // user's inbox and every attempt at it would read as "wrong code".
    if (challengeID.current) return;

    const { status } = await sessionClient.requestStepUp({
      scope: EMAIL_VERIFY_SCOPE,
      onChallenge: (info) => {
        challengeID.current = info.challengeId;
      },
    });

    // "continue" means Prelude granted the scope outright, with no challenge to
    // answer. Nothing was emailed and there is nothing to type, so the grant is
    // recorded immediately rather than leaving the user at a code form that can
    // never be satisfied.
    if (status === "continue") {
      await recordVerification();
      return;
    }
    if (!challengeID.current) {
      throw new Error("Prelude opened no verification challenge.");
    }
    await sessionClient.startOTP({ challengeId: challengeID.current });
  }, [recordVerification]);

  const resendVerificationCode = useCallback(async () => {
    // No challenge open means the first attempt never got one — asking Prelude
    // to retry would then fail on a challenge that does not exist, which is the
    // one state the "send another" button exists to get out of.
    if (!challengeID.current) {
      await startEmailVerification();
      return;
    }
    await sessionClient.retryOTP();
  }, [startEmailVerification]);

  const verifyEmail = useCallback(
    async (code: string) => {
      if (!challengeID.current) {
        throw new Error("No verification is in progress.");
      }
      // Prelude decides whether the code is right; a wrong one throws here and
      // never reaches our API. On success the SDK refreshes the session, so the
      // token the next request carries holds the granted scope.
      await sessionClient.checkOTP({ code, challengeId: challengeID.current });
      challengeID.current = null;
      await recordVerification();
    },
    [recordVerification],
  );

  // Prelude has no anonymous step-up: a challenge is opened on a session, and
  // somebody who has forgotten their password has none. The emailed code is
  // therefore a *login* — the one channel that will mail a signed-out visitor
  // anything — and the password write is authorized by a step-up on the session
  // it produces. See CLAUDE.md, "Password reset", for what that costs.
  const startPasswordReset = useCallback(async (email: string) => {
    if (!OTP_LOGIN_CONFIG_ID) {
      // Named so the screen can say *this* rather than "we could not send a
      // code": errorMessage only surfaces our API's own messages, so an
      // unnamed Error here would render as a Prelude outage and send whoever
      // reads it looking for one. A build that lost the variable is the real
      // cause, and the deploy script refuses to ship without it.
      const unconfigured = new Error(
        "Password reset is unconfigured: VITE_PRELUDE_OTP_LOGIN_CONFIG_ID is empty.",
      );
      unconfigured.name = RESET_UNCONFIGURED_ERROR;
      throw unconfigured;
    }
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
      // Prelude checks the code and finalizes a session from it; a wrong one
      // throws here as a typed SDK error and never reaches our API.
      await sessionClient.checkOTP({ code });
      await completeSignIn();

      const { status } = await sessionClient.requestStepUp({ scope: PASSWORD_WRITE_SCOPE });
      if (status !== "continue") {
        // The scope is configured to be granted outright, because the code just
        // entered is the same proof a challenge here would ask for a second
        // time. Anything else means the step-up configuration was changed, and
        // saying so beats stranding the visitor at a password form that cannot
        // save.
        throw new Error(`Prelude answered the password step-up with "${status}".`);
      }

      // A granted-outright scope arrives with no challenge to complete, so
      // nothing has refreshed the session — and the cached access token can
      // still predate the grant. canChangePassword is that forced refresh, and
      // it reads the scope off the new token, so a token that somehow lacks it
      // fails here rather than as an opaque rejection of the password itself.
      if (!(await sessionClient.canChangePassword())) {
        throw new Error("The session did not receive permission to change the password.");
      }
    },
    [completeSignIn],
  );

  const changePassword = useCallback(async (password: string) => {
    await sessionClient.changePassword(password);
    // Nothing local to reload: the password lives in Prelude, and our own record
    // of this account is untouched by it.
  }, []);

  const signOutOtherDevices = useCallback(async () => {
    await sessionClient.revokeSessions("others");
  }, []);

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
      changePassword,
      signOutOtherDevices,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
