import { ClientOnly } from "@/app/client";

// The editor's own address, and a segment of its own for one reason: without it
// `/songs/new` matches the sibling `[id]` route, whose generateMetadata would go
// looking for a song called "new" and whose redirect branch would be reasoning
// about the editor's address as though it were a song's. A static segment
// outranks a dynamic one, which is the same precedence the react-router table
// relies on for this same pair (App.tsx).
//
// Nothing here has metadata to add: the editor is a form behind a permission
// check, so there is nothing for a crawler to read and no card worth building.
// The layout's own description stands, and `PageTitle` names the tab as it
// always did.
//
// Migration 000010 refuses `new` as a slug, so no song is shadowed by this —
// pinned by TestASongIsNeverSluggedNew. A sibling added here needs the same
// treatment, since nothing checks that the two lists agree.
export default function Page() {
  return <ClientOnly />;
}
