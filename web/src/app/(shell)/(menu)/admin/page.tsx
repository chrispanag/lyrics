import { redirect } from "next/navigation";

import { ADMIN_TABS } from "@/routes/adminTabs";

// The navigation names the section, which has no screen of its own: a server
// redirect to the first tab. Not permanent, since the tab order may change.
export default function Page() {
  redirect(ADMIN_TABS[0].to);
}
