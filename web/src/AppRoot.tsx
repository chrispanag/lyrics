import { StrictMode } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { shouldRetry } from "./api/client";
import { AuthProvider } from "./auth/AuthProvider";

// Everything main.tsx used to mount, minus the two things Next now owns: the
// stylesheet (imported by app/layout.tsx) and the render call itself. The theme
// is applied by an inline script in that layout rather than here, because by
// the time this module runs the document has already painted.
//
// This module is only ever reached through `dynamic(..., { ssr: false })`, so it
// runs in the browser exactly as it did under Vite — which is what keeps the
// query client a module singleton rather than something built per request.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refetching on every window focus is noise for a catalog that changes
      // rarely, and on mobile it fires on every app switch.
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      retry: shouldRetry,
    },
  },
});

export default function AppRoot() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* AuthProvider sits inside the router and query client: it reads the
              query client to invalidate caches on sign-in and sign-out. */}
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
}
