import { AdminConsole } from "@/routes/AdminPages";
import { RequireAdmin } from "@/routes/guards";

/*
 * The console's guard and chrome around every screen under /admin, so a screen
 * added here is admin-only by position rather than by a wrapper it has to be
 * given. Its own route, so its chunk reaches only those who open it.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAdmin>
      <AdminConsole>{children}</AdminConsole>
    </RequireAdmin>
  );
}
