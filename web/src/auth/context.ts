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

/**
 * The `name` of the error `startPasswordChange` throws when Prelude hands over
 * the password scope with no challenge to answer.
 *
 * A `continue` status on `prld:pwd:write` grants the scope to any live session.
 * That is what the reset flow is built on — its emailed code proved the mailbox
 * seconds earlier — and it is the one thing a signed-in change-password screen
 * cannot accept: a session is all that a stolen session is, and the code is the
 * only thing in this flow that the thief would not also have. So the screen
 * refuses rather than changing a password on no proof, and this name is what
 * lets it say *that* instead of blaming the network. Matched by name for the
 * same reason as [RESET_UNCONFIGURED_ERROR]: the page must not import the SDK.
 */
export const PASSWORD_CHANGE_UNAVAILABLE_ERROR = "PasswordChangeUnavailableError";

/**
 * Builds an `Error` carrying a `name` the screens match on.
 *
 * The name is the whole mechanism — `errorMessage` carries through only our
 * API's own messages, so a plain `Error` renders as a generic failure — and
 * setting it takes three statements that read as ceremony around the one that
 * matters. Declared beside the two names it is used with, and with the SDK's own
 * (`BadCheckCodeError`, `ForbiddenError`) which the screens match the same way.
 */
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
   * Submits the emailed code, which signs the visitor in and asks Prelude for
   * the scope that permits a password write.
   *
   * Resolves with whether that ask produced a second code. `prld:pwd:write` is
   * configured to demand one, because the same entry serves the signed-in
   * change-password screen and has to be strict there — so the reset proves the
   * mailbox twice, seconds apart, and `confirmPasswordWriteCode` answers the
   * second challenge. A configuration that grants the scope outright emails
   * nothing and resolves `false`: this is the one flow entitled to read that as
   * permission already given, the code just entered being the same proof.
   *
   * Either way the visitor is a signed-in user from this point on, which is why
   * the reset screen must not send a signed-in visitor away.
   */
  confirmPasswordResetCode(code: string): Promise<{ secondCodeSent: boolean }>;
  /**
   * Opens the challenge that lets a signed-in user write a new password, and
   * has Prelude email its code.
   *
   * Safe to call again, like `startEmailVerification`, and for the same reason:
   * an unfinished challenge is reused rather than replaced, so a remount cannot
   * retire the code already sitting in the inbox. Throws an error named
   * [PASSWORD_CHANGE_UNAVAILABLE_ERROR] when Prelude asks for nothing.
   */
  startPasswordChange(): Promise<void>;
  /**
   * Submits the code that permits the write. Resolving means `changePassword`
   * can be called.
   *
   * Named for the scope rather than for either caller, because both flows call
   * it: it is the same challenge for the same `prld:pwd:write`, opened by
   * `confirmPasswordResetCode` on one path and `startPasswordChange` on the
   * other.
   */
  confirmPasswordWriteCode(code: string): Promise<void>;
  /** Asks Prelude to send that code again, opening a fresh challenge if it must. */
  resendPasswordWriteCode(): Promise<void>;
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
