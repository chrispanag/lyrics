import { QueryClient } from "@tanstack/react-query";

import type { AuthContextValue } from "@/auth/context";
import type { User } from "@/lib/types";

/*
 * The providers a component reaches for outside the root layout, as specs and
 * stories both need them: `renderWithProviders` and `.storybook/preview.tsx`.
 */

/** A fresh client per render, so no cached answer leaks between cases. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Retries turn an intentional error case into a multi-second wait.
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * An auth context whose every action resolves and does nothing, so nothing
 * here touches the Prelude SDK.
 */
export function stubAuth(
  user: User | null,
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user,
    loading: false,
    register: async () => {},
    login: async () => {},
    logout: async () => {},
    reload: async () => {},
    startEmailVerification: async () => {},
    verifyEmail: async () => {},
    resendVerificationCode: async () => {},
    startPasswordReset: async () => {},
    resendPasswordResetCode: async () => {},
    confirmPasswordResetCode: async () => ({ secondCodeSent: false }),
    startPasswordChange: async () => {},
    confirmPasswordWriteCode: async () => {},
    resendPasswordWriteCode: async () => {},
    changePassword: async () => {},
    signOutOtherDevices: async () => {},
    validatePassword: async () => ({ valid: true, messages: [] }),
    ...overrides,
  };
}
