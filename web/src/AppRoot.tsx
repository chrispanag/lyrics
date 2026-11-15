import { StrictMode, useLayoutEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import {
  type DehydratedState,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";

import { App } from "./App";
import { shouldRetry } from "./api/client";
import { AuthProvider } from "./auth/AuthProvider";
import { markAppMounted } from "./lib/appMounted";

// Only reached through `dynamic(..., { ssr: false })`, so this runs in the
// browser alone and the query client can be a module singleton. The theme is
// applied by app/layout.tsx's inline script; by now the document has painted.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The catalog changes rarely, and on mobile focus fires on every app switch.
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      retry: shouldRetry,
    },
  },
});

/**
 * `dehydratedState` is what a server page already read, as cache entries, so
 * the page that asks for it renders at once instead of fetching it again. The
 * page decides how fresh each entry claims to be. `HydrationBoundary` writes
 * entries the cache lacks during render, before anything below reads them.
 */
export default function AppRoot({
  dehydratedState,
}: {
  dehydratedState?: DehydratedState | undefined;
}) {
  // After the whole tree's layout effects and before paint, so the server's
  // stand-in and the app are never on screen together.
  useLayoutEffect(markAppMounted, []);

  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={dehydratedState}>
          <BrowserRouter>
            {/* Inside the query client: it invalidates caches on sign-in/out. */}
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </HydrationBoundary>
      </QueryClientProvider>
    </StrictMode>
  );
}
