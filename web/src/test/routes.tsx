import type { ReactNode } from "react";

import { RouteParams, useCurrentHref, usePathname } from "@/lib/navigation";
import { bestMatch } from "./match";

/*
 * Routing for specs and stories, beside `TestProviders` and for the same
 * reason: a spec says which screen answers which address and never how the
 * router is told. `./app.tsx` builds the same from the real app directory.
 */

/**
 * Mounts each element at its route pattern (`/songs/:id`), so a page reads its
 * params and a navigation lands on whatever stands in at the destination.
 * Renders nothing at an address no pattern matches.
 */
export function TestRoutes({ routes }: { routes: Record<string, ReactNode> }) {
  const match = bestMatch(Object.keys(routes), usePathname());
  if (!match) return null;
  return (
    <RouteParams key={match.pattern} params={match.params}>
      {routes[match.pattern]}
    </RouteParams>
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
