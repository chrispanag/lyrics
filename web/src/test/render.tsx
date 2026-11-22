import type { QueryClient } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { testQueryClient } from "./providers";
import { TestProviders } from "./TestProviders";
import type { AuthContextValue } from "@/auth/context";
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
    /** A client already holding data, for specs that start from a warm cache. */
    queryClient?: QueryClient;
  } & Omit<RenderOptions, "wrapper"> = {},
) {
  const { user = null, route = "/", auth, queryClient = testQueryClient(), ...rest } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestProviders user={user} route={route} auth={auth} queryClient={queryClient}>
        {children}
      </TestProviders>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...rest }) };
}
