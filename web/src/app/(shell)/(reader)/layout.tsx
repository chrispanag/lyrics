import { ReaderSplit } from "@/components/ReaderSplit";

/*
 * The catalog and a song, side by side from `lg` up: the list on the left, the
 * lyrics on the right. Below that the address picks one of them and it fills
 * the page. The catalog is its own slot, so opening a song keeps the list the
 * reader was scrolling instead of building it again.
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
