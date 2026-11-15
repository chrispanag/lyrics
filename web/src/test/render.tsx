import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

import { stubAuth, testQueryClient } from "./providers";
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
  const queryClient = testQueryClient();
  const authValue = stubAuth(user, auth);

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
