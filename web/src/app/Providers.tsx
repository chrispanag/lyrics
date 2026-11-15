"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { shouldRetry } from "@/api/client";
import { AuthProvider } from "@/auth/AuthProvider";
import { NextNavigation } from "@/lib/nextNavigation";
import { VerificationGate } from "@/routes/guards";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The catalog changes rarely, and on mobile focus fires on every app switch.
        refetchOnWindowFocus: false,
        staleTime: 60_000,
        retry: shouldRetry,
      },
    },
  });
}

/**
 * Everything every route renders inside, mounted once by the root layout.
 *
 * The query client is made per mount, in state, and never at module scope: on
 * a server a module-scope client would be one cache shared by every request,
 * so one visitor's data could render into another's page. In the browser the
 * root layout mounts once, so this is still one client for the session.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <NextNavigation>
        {/* Inside the query client: it invalidates caches on sign-in/out. */}
        <AuthProvider>
          <VerificationGate>{children}</VerificationGate>
        </AuthProvider>
      </NextNavigation>
    </QueryClientProvider>
  );
}
