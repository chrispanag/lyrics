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
  } & Omit<RenderOptions, "wrapper"> = {},
) {
  const { user = null, route = "/", auth, ...rest } = options;
  const queryClient = testQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestProviders user={user} route={route} auth={auth} queryClient={queryClient}>
        {children}
      </TestProviders>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...rest }) };
}
