import { createContext } from "react";

import type { User } from "@/lib/types";

export interface AuthContextValue {
  /** The signed-in user, or null for a guest. */
  user: User | null;
  /** True until the initial session check completes. */
  loading: boolean;
  register(input: { email: string; password: string; displayName?: string }): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
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
