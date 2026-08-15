import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { shouldRetry } from "./api/client";
import { AuthProvider } from "./auth/AuthProvider";
import { applyTheme, storedTheme } from "./lib/theme";
import "./styles/index.css";

// Applied before the first render so the page never flashes the wrong theme.
applyTheme(storedTheme());

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

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root is missing from index.html");

createRoot(container).render(
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
  </StrictMode>,
);
