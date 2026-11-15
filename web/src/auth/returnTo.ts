/*
 * Where signing in sends a visitor afterwards. One module for every writer and
 * the reader, so the address (search string included) means the same everywhere.
 *
 * It travels in the sign-in screen's own address, as `?next=`, rather than in
 * router state: state is react-router's alone, and the URL survives a reload of
 * the sign-in screen as well. The cost is that anyone can write the parameter,
 * so the reader accepts only a path on this site. See CLAUDE.md, "The routing
 * seam".
 */

import { useCurrentHref } from "@/lib/navigation";

/** The query parameter the sign-in screen reads its destination from. */
const NEXT = "next";

/** The sign-in screen, asked to come back to `here` (a path, search included) afterwards. */
export function signInHref(here: string): string {
  return `/login?${new URLSearchParams({ [NEXT]: here })}`;
}

/**
 * The sign-in screen, asked to come back to the current address. The router's
 * address, search string included, so a guard that redirects mid-navigation
 * records where the visitor was headed and a filter survives the detour.
 */
export function useSignInHref(): string {
  return signInHref(useCurrentHref());
}

/**
 * Where to go now, for the screen that has just signed someone in. Anything
 * that is not a path on this site — an absolute URL, a protocol-relative
 * `//host`, or a backslash a browser reads as one — falls back to the catalog,
 * or the parameter would be an open redirect.
 */
export function returnDestination(params: Pick<URLSearchParams, "get">): string {
  const raw = params.get(NEXT);
  if (!raw?.startsWith("/")) return "/";

  // Resolved against a stand-in origin, which a same-site path cannot leave.
  // The parser also does what a browser would to `/\host` and to tabs or
  // newlines inside `//host`, so those cannot slip past a prefix check.
  const origin = "https://app.invalid";
  const url = new URL(raw, origin);
  if (url.origin !== origin) return "/";
  return url.pathname + url.search + url.hash;
}
