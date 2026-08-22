import { lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { returnTo } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { Layout } from "@/components/Layout";
import { PageTitle } from "@/components/PageTitle";
import { EmptyState, Spinner } from "@/components/ui";
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

// The editor and admin console are reachable by a small minority of visitors
// and pull in form machinery nobody else needs, so they load on demand rather
// than in the initial bundle every guest downloads.
const SongEditorPage = lazy(() =>
  import("@/routes/SongEditorPage").then((m) => ({ default: m.SongEditorPage })),
);
// All three come from one module and so share one chunk, which is what makes
// moving between the console's screens cost no second request.
const AdminConsole = lazy(() =>
  import("@/routes/AdminPages").then((m) => ({ default: m.AdminConsole })),
);
const AdminUsersPage = lazy(() =>
  import("@/routes/AdminPages").then((m) => ({ default: m.AdminUsersPage })),
);
const AdminGenresPage = lazy(() =>
  import("@/routes/AdminPages").then((m) => ({ default: m.AdminGenresPage })),
);

/**
 * Requires a session before rendering.
 *
 * This only controls what is displayed — every one of these routes is also
 * enforced server-side, because a route guard is trivially bypassed.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const routerLocation = useLocation();

  if (loading) return <Spinner />;
  if (!user) {
    return <Navigate to="/login" replace state={returnTo(routerLocation)} />;
  }
  return <>{children}</>;
}

/**
 * Requires an admin before rendering.
 *
 * Wraps the console's layout route rather than each screen inside it, so a
 * screen added there is admin-only by its position in the tree instead of by
 * someone remembering the wrapper. Kept out of the pages themselves for the
 * same reason it is not a check inside them: the console's chunk is then never
 * downloaded by anyone who cannot open it. The wait on `loading` is not
 * optional either — `user` is null while the session is being restored, so
 * deciding before it settles turns a refresh on an admin screen into a bounce
 * to the catalog.
 *
 * A visitor who is not an admin is sent to the catalog rather than to sign in
 * the way `RequireAuth` does — being asked to sign in is an answer about what
 * exists here, and the server enforces every one of these routes regardless.
 */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;
  if (!hasRole(user?.role, "admin")) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * The screens an unverified account is left on rather than redirected away from.
 *
 * The verification screen is the obvious one. Password reset is here because its
 * emailed code is a login: from the moment the code is accepted the visitor is a
 * signed-in user, and an unverified account would be bounced out of the flow one
 * step short of the new password — landing on a code form for a different
 * challenge, which is indistinguishable from the reset code not working.
 */
const UNVERIFIED_ROUTES = new Set(["/verify-email", "/forgot-password"]);

/**
 * Holds an unverified account on the verification screen.
 *
 * The server refuses everything else it asks for, so any other page would
 * render its own version of "something went wrong" — a list that will not load,
 * an editor that cannot save — instead of the one thing left to do.
 *
 * Guests are untouched: the catalog is public, and `user` stays null while the
 * session is still being restored, so this never delays a first paint.
 */
function VerificationGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const routerLocation = useLocation();

  if (user && !user.email_verified_at && !UNVERIFIED_ROUTES.has(routerLocation.pathname)) {
    return <Navigate to="/verify-email" replace />;
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
        {/* Signed in, and still outside the shell: this flow's steps are state
            rather than routes, so a navigation away is the flow lost part-way
            through. Guarded here rather than inside the page, like every other
            route that needs a session — a guest following the link is sent to
            sign in and returned. */}
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePasswordPage />
            </RequireAuth>
          }
        />

        <Route element={<Layout />}>
          <Route index element={<BrowsePage />} />
          <Route path="/songs/new" element={<SongEditorPage />} />
          <Route path="/songs/:id" element={<SongDetailPage />} />
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
          {/* One guarded section, not two guarded screens. The navigation
              carries a single entry and points at `/admin` itself, so that
              entry stays lit on every screen inside — which is what the index
              redirect is for, the section needing a screen to open on. */}
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminConsole />
              </RequireAdmin>
            }
          >
            <Route index element={<Navigate to={ADMIN_TABS[0].to} replace />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="genres" element={<AdminGenresPage />} />
          </Route>

          {/* The catch-all renders rather than redirecting, so it needs naming
              like any other screen: without this a mistyped URL keeps whatever
              title the previous page set, and the tab goes on claiming a song
              that is not on screen. */}
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
      </Routes>
    </VerificationGate>
  );
}
