import { ChangePasswordPage } from "@/routes/AuthPages";
import { RequireAuth } from "@/routes/guards";

// Outside the shell with the other credential screens: its steps are state,
// not routes, so navigation offered beside them loses the flow part-way.
export default function Page() {
  return (
    <RequireAuth title="Change password">
      <ChangePasswordPage />
    </RequireAuth>
  );
}
