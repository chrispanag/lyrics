import { createContext } from "react";

import type { User } from "@/lib/types";

/**
 * The `name` of the error `startPasswordReset` throws when no OTP login
 * configuration was built in.
 *
 * Matched by name, the way the SDK's own errors are, and declared here rather
 * than beside either end of it: the provider that throws it imports the Prelude
 * SDK, and the screen that reads it must not — that is what lets the auth
 * screens be tested without a session client.
 */
export const RESET_UNCONFIGURED_ERROR = "PasswordResetUnconfiguredError";

export interface AuthContextValue {
  /** The signed-in user, or null for a guest. */
  user: User | null;
  /** True until the initial session check completes. */
  loading: boolean;
  register(input: { email: string; password: string; displayName?: string }): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /**
   * Opens the email verification challenge and has Prelude send the code.
   *
   * Safe to call again: an unfinished challenge is reused rather than replaced,
   * so a re-render does not silently invalidate the code already in the inbox.
   */
  startEmailVerification(): Promise<void>;
  /** Submits the emailed code, then records the grant with our API. */
  verifyEmail(code: string): Promise<void>;
  /** Asks Prelude to send the code again for the challenge already open. */
  resendVerificationCode(): Promise<void>;
  /**
   * Emails a code to an address that has forgotten its password.
   *
   * Resolves the same way whether or not the address has an account — Prelude
   * answers a dispatch for an unknown identifier with a silent 204 and creates
   * nothing — so a caller must not treat this resolving as proof that an account
   * exists, and must not branch on it. That is what keeps the screen from
   * reporting which addresses are registered.
   */
  startPasswordReset(email: string): Promise<void>;
  /** Asks Prelude to send the reset code again. */
  resendPasswordResetCode(): Promise<void>;
  /**
   * Submits the emailed code, which signs the visitor in and acquires the scope
   * that permits a password write.
   *
   * Resolving means `changePassword` can be called; the visitor is a signed-in
   * user from this point on, which is why the reset screen must not send a
   * signed-in visitor away.
   */
  confirmPasswordResetCode(code: string): Promise<void>;
  /** Writes the new password. Only callable after the code was accepted. */
  changePassword(password: string): Promise<void>;
  /** Ends every session but this one, e.g. after a password reset. */
  signOutOtherDevices(): Promise<void>;
  /**
   * Re-reads the profile from our API, e.g. after a role change.
   *
   * A caller that already holds the updated user — a profile save responds with
   * it — passes it in rather than paying for a second round trip for a record
   * it just received.
   */
  reload(next?: User): Promise<void>;
  /** Checks a password against the app's configured rules. */
  validatePassword(password: string): Promise<{ valid: boolean; messages: string[] }>;
}

/**
 * Lives in its own module so AuthProvider.tsx exports only a component, which
 * is what keeps fast refresh working during development.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);
