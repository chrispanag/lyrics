import { SongNotFound } from "@/routes/SongDetailPage";

// What `notFound()` in `./page.tsx` renders, with a 404 and Next's `noindex`:
// the song page's own "not available", inside the shell this segment sits in.
export default function NotFound() {
  return <SongNotFound />;
}
