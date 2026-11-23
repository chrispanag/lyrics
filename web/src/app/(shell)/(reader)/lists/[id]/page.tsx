import { EmptyReadingPane } from "../../readingPane";

export { generateMetadata } from "../../listPage";

/*
 * A list's own address. The `@catalog` slot renders the list; this is the
 * reading pane beside it, with no song open, as beside the catalog.
 */
export default function ListReadingPane() {
  return <EmptyReadingPane />;
}
