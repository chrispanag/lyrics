import { createContext } from "react";

import type { User } from "@/lib/types";

/**
 * The `name` of the error `startPasswordReset` throws when no OTP login
 * configuration was built in. Lives here because the screen matching it must
 * not import the SDK.
 */
export const RESET_UNCONFIGURED_ERROR = "PasswordResetUnconfiguredError";

/**
 * The `name` of the error `startPasswordChange` throws when Prelude grants the
 * password scope with no challenge, which the screen refuses (a session alone
 * proves nothing a thief lacks).
 */
export const PASSWORD_CHANGE_UNAVAILABLE_ERROR = "PasswordChangeUnavailableError";

/** Builds an `Error` carrying a `name` the screens match on. */
export function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export interface AuthContextValue {
  /** The signed-in user, or null for a guest. */
  user: User | null;
  /** True until the initial session check completes. */
  loading: boolean;
  register(input: { email: string; password: string; displayName?: string }): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /**
   * Opens the email verification challenge and has Prelude send the code. Safe
   * to call again: an unfinished challenge is reused.
   */
  startEmailVerification(): Promise<void>;
  /** Submits the emailed code, then records the grant with our API. */
  verifyEmail(code: string): Promise<void>;
  /** Asks Prelude to send the code again for the challenge already open. */
  resendVerificationCode(): Promise<void>;
  /**
   * Emails a code to an address that has forgotten its password. Resolves the
   * same for unknown addresses; never branch on it, or it leaks which exist.
   */
  startPasswordReset(email: string): Promise<void>;
  /** Asks Prelude to send the reset code again. */
  resendPasswordResetCode(): Promise<void>;
  /**
   * Submits the emailed code, which signs the visitor in, and asks for the
   * password-write scope. Resolves with whether a second code was sent
   * (`confirmPasswordWriteCode` answers it). The visitor is signed in from here,
   * so the reset screen must not redirect signed-in visitors.
   */
  confirmPasswordResetCode(code: string): Promise<{ secondCodeSent: boolean }>;
  /**
   * Opens the challenge that lets a signed-in user write a new password, and
   * has Prelude email its code. Safe to call again. Throws an error named
   * [PASSWORD_CHANGE_UNAVAILABLE_ERROR] when Prelude asks for nothing.
   */
  startPasswordChange(): Promise<void>;
  /**
   * Submits the code that permits the write, for both reset and change. Resolving
   * means `changePassword` can be called.
   */
  confirmPasswordWriteCode(code: string): Promise<void>;
  /** Asks Prelude to send that code again, opening a fresh challenge if it must. */
  resendPasswordWriteCode(): Promise<void>;
  /** Writes the new password. Only callable after the code was accepted. */
  changePassword(password: string): Promise<void>;
  /** Ends every session but this one, e.g. after a password reset. */
  signOutOtherDevices(): Promise<void>;
  /** Re-reads the profile from our API, or takes an updated user already in hand. */
  reload(next?: User): Promise<void>;
  /** Checks a password against the app's configured rules. */
  validatePassword(password: string): Promise<{ valid: boolean; messages: string[] }>;
}

/** Here, not in AuthProvider.tsx, so that file exports only a component (fast refresh). */
export const AuthContext = createContext<AuthContextValue | null>(null);
