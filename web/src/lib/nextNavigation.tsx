"use client";

import NextLink from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useMemo } from "react";

import { type BackendLinkProps, type NavigationBackend, NavigationProvider } from "./navigation";

/*
 * The seam's production backend: Next's App Router. Its own module so that
 * `next/navigation` and `next/link` are imported by nothing a spec or a story
 * loads — the seam and its in-memory `TestRouter` never touch them. See
 * CLAUDE.md, "The routing seam".
 */

/**
 * `scroll={false}`: Next scrolls a new page into view on its own, by a rule of
 * its own, and `Layout`'s pathname-keyed scroll to the top is the app's. Two
 * rules would disagree about a filter written into the catalog's query string,
 * which must not scroll at all.
 */
function NextBackendLink({ href, replace, ...rest }: BackendLinkProps) {
  // Cast: Next's props type its handlers as never-undefined, which
  // `exactOptionalPropertyTypes` will not take from an anchor's props.
  return <NextLink href={href} replace={replace} scroll={false} {...(rest as object)} />;
}

/** Mounts the seam on Next's router. Once, in the root layout's providers. */
export function NextNavigation({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams();

  // Next's router object is stable, so these are too, as the seam promises.
  const moves = useMemo(
    () => ({
      push: (href: string) => router.push(href, { scroll: false }),
      replace: (href: string) => router.replace(href, { scroll: false }),
      back: () => router.back(),
      // The History API rather than the router: Next keeps `useSearchParams`
      // in step with it and asks the server for nothing, where `router.replace`
      // re-renders the route on the server for every keystroke typed into the
      // catalog's search box. The search string is the screen's own state; a
      // document load still renders it on the server.
      writeSearch: (href: string, { replace }: { replace: boolean }) => {
        if (replace) window.history.replaceState(null, "", href);
        else window.history.pushState(null, "", href);
      },
    }),
    [router],
  );

  const backend = useMemo<NavigationBackend>(
    () => ({ pathname, searchParams, params, ...moves, Link: NextBackendLink }),
    [pathname, searchParams, params, moves],
  );

  return <NavigationProvider backend={backend}>{children}</NavigationProvider>;
}
