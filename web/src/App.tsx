import { lazy } from "react";
import { Outlet, Route, Routes } from "react-router-dom";

import { useSignInHref } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { Layout } from "@/components/Layout";
import { MenuHeader } from "@/components/SearchHeader";
import { PageTitle } from "@/components/PageTitle";
import { EmptyState, Spinner } from "@/components/ui";
import { Redirect, usePathname } from "@/lib/navigation";
import { hasRole } from "@/lib/types";
import {
  ChangePasswordPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  VerifyEmailPage,
} from "@/routes/AuthPages";
import { BrowsePage } from "@/routes/BrowsePage";
import { ADMIN_TABS } from "@/routes/adminTabs";
import { ListDetailPage, ListsPage } from "@/routes/ListsPages";
import { ProfilePage } from "@/routes/ProfilePage";
import { SongDetailPage } from "@/routes/SongDetailPage";

// The editor and admin console serve few visitors, so they load on demand.
const SongEditorPage = lazy(() =>
  import("@/routes/SongEditorPage").then((m) => ({ default: m.SongEditorPage })),
);
// All three share one module, so one chunk serves every console screen.
const AdminConsole = lazy(() =>
  import("@/routes/AdminPages").then((m) => ({ default: m.AdminConsole })),
);
const AdminUsersPage = lazy(() =>
  import("@/routes/AdminPages").then((m) => ({ default: m.AdminUsersPage })),
);
const AdminGenresPage = lazy(() =>
  import("@/routes/AdminPages").then((m) => ({ default: m.AdminGenresPage })),
);

/** Requires a session before rendering. Display only; the server enforces. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const signIn = useSignInHref();

  if (loading) return <Spinner />;
  if (!user) return <Redirect href={signIn} />;
  return <>{children}</>;
}

/**
 * Requires an admin before rendering. Wraps the console's layout route, so a
 * screen added inside is admin-only by position. Must block on `loading`: until
 * the restore settles, `user` is only the stored snapshot. See CLAUDE.md,
 * "Frontend" (the admin console bullet).
 */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;
  if (!hasRole(user?.role, "admin")) return <Redirect href="/" />;
  return <>{children}</>;
}

/**
 * Screens an unverified account is not redirected away from. The reset is here
 * because its code signs the visitor in; bounced mid-flow, the reset dead-ends.
 */
const UNVERIFIED_ROUTES = new Set(["/verify-email", "/forgot-password"]);

/**
 * Gives every screen without a search box the app bar carrying the phone's
 * hamburger. A layout route, so a new screen gets it by position; a screen left
 * out has no navigation on a phone. Guards stay inside it, so the bar shows
 * while a session restores. See CLAUDE.md, "Frontend".
 */
function MenuBarLayout() {
  return (
    <>
      <MenuHeader />
      <Outlet />
    </>
  );
}

/**
 * Holds an unverified account on the verification screen; the server refuses
 * it everything else. Renders through the session restore, but must not decide
 * until `loading` clears: `user` starts as a possibly stale snapshot.
 */
function VerificationGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (!loading && user && !user.email_verified_at && !UNVERIFIED_ROUTES.has(pathname)) {
    return <Redirect href="/verify-email" />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <VerificationGate>
      <Routes>
        {/* Auth screens sit outside the shell: they have no navigation. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        {/* Outside the shell: its steps are state, so navigating away loses the flow. */}
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePasswordPage />
            </RequireAuth>
          }
        />

        <Route
          element={
            <Layout>
              <Outlet />
            </Layout>
          }
        >
          {/* Both render a search box, which carries the hamburger. */}
          <Route index element={<BrowsePage />} />
          <Route path="/songs/:id" element={<SongDetailPage />} />

          <Route element={<MenuBarLayout />}>
            {/* A static segment under /songs/ must be a slug no song can hold.
                `new` is reserved in migration 000010 (TestASongIsNeverSluggedNew);
                a new sibling needs reserving there too. */}
            <Route path="/songs/new" element={<SongEditorPage />} />
            <Route path="/songs/:id/edit" element={<SongEditorPage />} />
            <Route
              path="/lists"
              element={
                <RequireAuth>
                  <ListsPage />
                </RequireAuth>
              }
            />
            <Route path="/lists/:id" element={<ListDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            {/* The nav entry points at `/admin`, so the index redirect picks a screen. */}
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminConsole>
                    <Outlet />
                  </AdminConsole>
                </RequireAdmin>
              }
            >
              <Route index element={<Redirect href={ADMIN_TABS[0].to} />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="genres" element={<AdminGenresPage />} />
            </Route>

            {/* Named, or the tab keeps the previous page's title. */}
            <Route
              path="*"
              element={
                <>
                  <PageTitle name="Page not found" />
                  <EmptyState
                    title="Page not found"
                    description="That link does not lead anywhere."
                  />
                </>
              }
            />
          </Route>
        </Route>
      </Routes>
    </VerificationGate>
  );
}
