import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { type ReactNode, useMemo, useState } from "react";

import { stubAuth, testQueryClient } from "./providers";
import { AuthContext, type AuthContextValue } from "@/auth/context";
import { HistoryProvider } from "@/lib/navigation";
import type { User } from "@/lib/types";

/**
 * The query client, router and auth stub a component reaches for outside
 * `AppRoot`, nested once for `renderWithProviders` and the Storybook preview.
 * The router is the one place here that names react-router; everything below
 * it goes through `@/lib/navigation`, so moving routers swaps this provider and
 * `./routes.tsx` alone.
 * Pass `queryClient` to keep a handle on it; otherwise each mount makes its own.
 */
export function TestProviders({
  user = null,
  route = "/",
  auth,
  queryClient: given,
  children,
}: {
  user?: User | null | undefined;
  /** The address to render at, or the history behind it (oldest first). */
  route?: string | string[] | undefined;
  auth?: Partial<AuthContextValue> | undefined;
  queryClient?: ReturnType<typeof testQueryClient> | undefined;
  children: ReactNode;
}) {
  const [client] = useState(() => given ?? testQueryClient());
  // Stable across re-renders, or every consumer of the context re-renders too.
  const authValue = useMemo(() => stubAuth(user, auth), [user, auth]);
  const entries = Array.isArray(route) ? route : [route];

  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>
        <HistoryProvider entriesBehind={entries.length > 1}>
          <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
        </HistoryProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
