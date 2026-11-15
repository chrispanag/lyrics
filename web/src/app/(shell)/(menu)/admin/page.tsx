import { redirect } from "next/navigation";

import { ADMIN_TABS } from "@/routes/adminTabs";

// The navigation names the section, which has no screen of its own. A request
// never gets here: `next.config.ts` redirects `/admin` before any route renders,
// which is the only way a document load gets a real 307 (this throw sits under
// `RequireAdmin`, which a server never opens). This page is the backstop, and
// what the specs' route tree follows.
export default function Page() {
  redirect(ADMIN_TABS[0].to);
}
