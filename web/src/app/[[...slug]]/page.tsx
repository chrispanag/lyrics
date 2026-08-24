import { ClientOnly } from "@/app/client";

// An optional catch-all, so every address the react-router table knows about
// reaches this one page — the replacement for nginx's `try_files … /index.html`
// and App Platform's `catchall_document`.
//
// Being their replacement, it inherits their hazard rather than closing it:
// **a missing file under public/ does not 404, it serves the app.** Verified
// against this server — `/definitely-missing.png` answers 200 with text/html,
// exactly as it did before. So the four icon entries in app/layout.tsx are
// still load-bearing for the reason CLAUDE.md gives under Head assets, and
// deleting one still fails open. Check the content type, not the status.
//
// `/songs/[id]` is the first address taken back off it, for its metadata and its
// JSON-LD, and `/songs/new` the second — and the two coexist with this one
// because a more specific segment always outranks a catch-all. What that route
// does *not* take is `/songs/[id]/edit`, which is two segments and so still
// arrives here.
export default function Page() {
  return <ClientOnly />;
}
