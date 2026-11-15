import { Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import { useCurrentHref } from "@/lib/navigation";

/*
 * Routing for specs and stories, beside `TestProviders` and for the same
 * reason: the only test code that names the router, so a spec says which
 * screen answers which address and never how the router is told.
 */

/**
 * Mounts each element at its route pattern (`/songs/:id`), so a page reads its
 * params and a navigation lands on whatever stands in at the destination.
 */
export function TestRoutes({ routes }: { routes: Record<string, ReactNode> }) {
  return (
    <Routes>
      {Object.entries(routes).map(([path, element]) => (
        <Route key={path} path={path} element={element} />
      ))}
    </Routes>
  );
}

/** The current address, path and search string, for specs that assert a destination. */
export function CurrentAddress({ label = "Now at" }: { label?: string }) {
  return (
    <p data-testid="location">
      {label} {useCurrentHref()}
    </p>
  );
}
