import { ClientOnly } from "@/app/client";

// Keeps `/songs/new` off the sibling `[id]` route; a static segment outranks a
// dynamic one. Migration 000010 reserves `new` as a slug
// (TestASongIsNeverSluggedNew); a sibling added here needs the same reservation.
export default function Page() {
  return <ClientOnly />;
}
