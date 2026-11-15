"use client";

import type { ReactNode } from "react";

import { useSignInHref } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { PageTitle } from "@/components/PageTitle";
import { Spinner } from "@/components/ui";
import { Redirect, usePathname } from "@/lib/navigation";
import { hasRole } from "@/lib/types";

/*
 * The guards the route layouts and pages wrap screens in. Display only: the
 * server enforces every rule. On a server the session is always still being
 * restored, so each renders its waiting state there — with a `<title>`, since
 * the screen that would name the tab is not rendered yet.
 */

/** Requires a session before rendering `children`, which `title` names. */
export function RequireAuth({ title, children }: { title: string; children: ReactNode }) {
  const { user, loading } = useAuth();
  const signIn = useSignInHref();

  if (loading) return <Waiting title={title} />;
  if (!user) return <Redirect href={signIn} />;
  return <>{children}</>;
}

/**
 * Requires an admin before rendering. Wraps the console's layout, so a screen
 * added inside is admin-only by position. Must block on `loading`: until the
 * restore settles, `user` is only the stored snapshot. See CLAUDE.md,
 * "Frontend" (the admin console bullet).
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <Waiting title="Admin" />;
  if (!hasRole(user?.role, "admin")) return <Redirect href="/" />;
  return <>{children}</>;
}

/**
 * A screen's waiting state, which names the tab: on a server it is all that
 * renders, so without the title the HTML would have none.
 */
export function Waiting({ title }: { title: string }) {
  return (
    <>
      <PageTitle name={title} />
      <Spinner />
    </>
  );
}

/**
 * Screens an unverified account is not redirected away from. The reset is here
 * because its code signs the visitor in; bounced mid-flow, the reset dead-ends.
 */
const UNVERIFIED_ROUTES = new Set(["/verify-email", "/forgot-password"]);

/**
 * Holds an unverified account on the verification screen; the server refuses
 * it everything else. Renders through the session restore, but must not decide
 * until `loading` clears: `user` starts as a possibly stale snapshot. Mounted
 * around every route by the root layout's providers.
 */
export function VerificationGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (!loading && user && !user.email_verified_at && !UNVERIFIED_ROUTES.has(pathname)) {
    return <Redirect href="/verify-email" />;
  }
  return <>{children}</>;
}
