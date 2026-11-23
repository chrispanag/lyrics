import { ReaderSplit } from "@/components/ReaderSplit";

/*
 * A list of songs and a song, side by side once the content column can hold
 * both: the catalog or one of the reader's lists on the left, the lyrics on the
 * right. Below that the address picks one of them and it fills the page.
 * Collapsing the navigation widens the column, so a narrower window can still
 * hold both. The list is its own slot (`@catalog`, which a list's page fills
 * too), so opening a song keeps the list the reader was scrolling instead of
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
