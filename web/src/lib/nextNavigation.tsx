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
 * Next's `PrefetchKind.FULL`: an enum no public entry point exports, so its type
 * is read off the public router's `prefetch` rather than imported from `next/dist`.
 */
type PrefetchKind = NonNullable<Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]>["kind"];
const FULL_PREFETCH = "full" as PrefetchKind;

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

interface NavigationApiEntry {
  key: string;
  index: number;
}

/** The Navigation API's entry showing, or the one `key` names, where the browser has one. */
function historyEntry(key?: string): NavigationApiEntry | undefined {
  const navigation = (
    window as {
      navigation?: { currentEntry: NavigationApiEntry | null; entries(): NavigationApiEntry[] };
    }
  ).navigation;
  if (!navigation) return undefined;
  const entry =
    key === undefined ? navigation.currentEntry : navigation.entries().find((e) => e.key === key);
  // -1 is an entry the API cannot place, such as one after `document.open()`.
  return entry && entry.index >= 0 ? { key: entry.key, index: entry.index } : undefined;
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
      // Moved at once by `writeSearch` below, where `useSearchParams` waits for a render.
      liveHref: () => window.location.pathname + window.location.search,
      // The History API rather than the router: Next keeps `useSearchParams`
      // in step with it and asks the server for nothing, where `router.replace`
      // re-renders the route on the server for every keystroke typed into the
      // catalog's search box. The search string is the screen's own state; a
      // document load still renders it on the server.
      writeSearch: (href: string, { replace }: { replace: boolean }) => {
        if (replace) window.history.replaceState(null, "", href);
        else window.history.pushState(null, "", href);
      },
      // The full kind: the default stops at the nearest `loading.tsx`, and
      // these routes have none, so it would load nothing worth having. The
      // payload is held for `staleTimes.static` (five minutes), and a
      // navigation to the same href, by link or by `replace`, is answered from it.
      prefetch: (href: string) => router.prefetch(href, { kind: FULL_PREFETCH }),
      historyEntry,
    }),
    [router],
  );

  const backend = useMemo<NavigationBackend>(
    () => ({ pathname, searchParams, params, ...moves, Link: NextBackendLink }),
    [pathname, searchParams, params, moves],
  );

  return <NavigationProvider backend={backend}>{children}</NavigationProvider>;
}
