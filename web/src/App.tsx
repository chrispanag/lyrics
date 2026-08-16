import { lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "@/auth/useAuth";
import { Layout } from "@/components/Layout";
import { EmptyState, Spinner } from "@/components/ui";
import { LoginPage, RegisterPage, VerifyEmailPage } from "@/routes/AuthPages";
import { BrowsePage } from "@/routes/BrowsePage";
import { ListDetailPage, ListsPage } from "@/routes/ListsPages";
import { ProfilePage } from "@/routes/ProfilePage";
import { SongDetailPage } from "@/routes/SongDetailPage";

// The editor and admin console are reachable by a small minority of visitors
// and pull in form machinery nobody else needs, so they load on demand rather
// than in the initial bundle every guest downloads.
const SongEditorPage = lazy(() =>
  import("@/routes/SongEditorPage").then((m) => ({ default: m.SongEditorPage })),
);
const AdminUsersPage = lazy(() =>
  import("@/routes/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })),
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
    // Remember where they were going so sign-in can return them there. The
    // router's location, not window.location, so a redirect mid-navigation
    // records the destination rather than the page being left.
    return <Navigate to="/login" replace state={{ from: routerLocation.pathname }} />;
  }
  return <>{children}</>;
}

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

  if (user && !user.email_verified_at && routerLocation.pathname !== "/verify-email") {
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
          <Route path="/admin/users" element={<AdminUsersPage />} />

          <Route
            path="*"
            element={
              <EmptyState
                title="Page not found"
                description="That link does not lead anywhere."
              />
            }
          />
        </Route>
      </Routes>
    </VerificationGate>
  );
}
