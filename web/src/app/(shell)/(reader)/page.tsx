import { EmptyReadingPane } from "./readingPane";

export { generateMetadata } from "./catalogPage";

/*
 * The catalog's own address. The `@catalog` slot renders the catalog; this is
 * the reading pane beside it, with no song open.
 */
export default function CatalogReadingPane() {
  return <EmptyReadingPane />;
}
