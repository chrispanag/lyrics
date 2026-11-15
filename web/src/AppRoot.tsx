import { StrictMode } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { shouldRetry } from "./api/client";
import { AuthProvider } from "./auth/AuthProvider";

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

export default function AppRoot() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* Inside the query client: it invalidates caches on sign-in/out. */}
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
}
