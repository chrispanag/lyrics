import { SongEditorPage } from "@/routes/SongEditorPage";

// A static segment under /songs/ must be a slug no song can hold. `new` is
// reserved in migration 000010 (TestASongIsNeverSluggedNew); a sibling added
// here needs the same reservation. It outranks `songs/[id]` by being static.
export default function Page() {
  return <SongEditorPage />;
}
