import { ClientOnly } from "@/app/client";

// What `notFound()` renders, with a 404 status and Next's `noindex`: the app
// itself, which shows its own "not available" for the address.
export default function NotFound() {
  return <ClientOnly />;
}
