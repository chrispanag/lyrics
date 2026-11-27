import { PlainSheet } from "@/components/PlainSheet";

/*
 * Every shell screen without a header of its own: your lists, the profile, the
 * admin console, the song editor, each on a `PlainSheet`. A layout, so a new
 * screen gets it by position. The catalog, a list and the song page sit
 * outside this group, in `(reader)`, which sets out its own sheets
 * (`ReaderSplit`).
 */
export default function PlainLayout({ children }: { children: React.ReactNode }) {
  return <PlainSheet>{children}</PlainSheet>;
}
