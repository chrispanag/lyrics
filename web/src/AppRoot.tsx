import { StrictMode, useLayoutEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { shouldRetry } from "./api/client";
import { keys } from "./api/hooks";
import { AuthProvider } from "./auth/AuthProvider";
import { markAppMounted } from "./lib/appMounted";
import type { Song } from "./lib/types";

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

/** A song the server already read, and the address it was read under. */
interface SeededSong {
  ref: string;
  song: Song;
}

/**
 * Puts the server's copy of a song where `useSong` looks, so the page renders
 * it at once instead of fetching it again.
 *
 * Stamped as old as possible: the server's read may be minutes stale (Next's
 * data cache), so the page shows it and refetches at once. Fresh, a reader who
 * reloads after an edit would see the version before it.
 */
function seed(seeded: SeededSong | undefined): void {
  if (!seeded) return;
  queryClient.setQueryData(keys.song(seeded.ref), seeded.song, { updatedAt: 0 });
}

export default function AppRoot({ seeded }: { seeded?: SeededSong | undefined }) {
  // Before the first render, once: the initializer is the only place that is both.
  useState(() => seed(seeded));
  // After the whole tree's layout effects and before paint, so the server's
  // stand-in and the app are never on screen together.
  useLayoutEffect(markAppMounted, []);

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
