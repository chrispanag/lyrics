import { ReaderSplit } from "@/components/ReaderSplit";

/*
 * The catalog and a song, side by side once the content column can hold both:
 * the list on the left, the lyrics on the right. Below that the address picks
 * one of them and it fills the page. Collapsing the navigation widens the
 * column, so a narrower window can still hold both. The catalog is its own
 * slot, so opening a song keeps the list the reader was scrolling instead of
 * building it again.
 */
export default function ReaderLayout({
  children,
  catalog,
}: {
  children: React.ReactNode;
  catalog: React.ReactNode;
}) {
  return <ReaderSplit catalog={catalog}>{children}</ReaderSplit>;
}
