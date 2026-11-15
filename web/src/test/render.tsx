import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

import { AuthContext, type AuthContextValue } from "@/auth/context";
import type { User } from "@/lib/types";

/**
 * Renders with the router, query client, and auth context in place. The auth
 * context is a stub, so tests never touch the Prelude SDK.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: {
    user?: User | null;
    /**
     * The address to render at, or the history behind it (oldest first,
     * rendered at the last), for specs that go Back.
     */
    route?: string | string[];
    auth?: Partial<AuthContextValue>;
  } & Omit<RenderOptions, "wrapper"> = {},
) {
  const { user = null, route = "/", auth, ...rest } = options;
  const entries = Array.isArray(route) ? route : [route];

  const queryClient = new QueryClient({
    defaultOptions: {
      // Retries turn an intentional error-case test into a multi-second wait.
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const authValue: AuthContextValue = {
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
    ...auth,
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={entries}>
          <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...rest }) };
}
