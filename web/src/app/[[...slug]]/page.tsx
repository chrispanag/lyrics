import { ClientOnly } from "@/app/client";

// Optional catch-all: every react-router address reaches this page, so a
// missing file under public/ answers 200 text/html rather than 404 (CLAUDE.md,
// Head assets). More specific segments (`/songs/[id]`, `/songs/new`) outrank it;
// `/songs/[id]/edit` still lands here.
export default function Page() {
  return <ClientOnly />;
}
