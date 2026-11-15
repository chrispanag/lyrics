import { redirect } from "next/navigation";

import { ADMIN_TABS } from "@/routes/adminTabs";

// No screen of its own. `next.config.ts` redirects /admin before this renders
// (see there for why); this is the backstop, and what the specs' route tree follows.
export default function Page() {
  redirect(ADMIN_TABS[0].to);
}
