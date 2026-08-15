import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

import { AuthContext, type AuthContextValue } from "@/auth/context";
import type { User } from "@/lib/types";

/**
 * Renders with the router, query client, and auth context in place.
 *
 * The auth context is stubbed rather than using the real AuthProvider, so
 * tests never touch the Prelude SDK — which would try to reach a live session
 * domain and makes the signed-in state hard to control.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: {
    user?: User | null;
    route?: string;
    auth?: Partial<AuthContextValue>;
  } & Omit<RenderOptions, "wrapper"> = {},
) {
  const { user = null, route = "/", auth, ...rest } = options;

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
    validatePassword: async () => ({ valid: true, messages: [] }),
    ...auth,
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...rest }) };
}
