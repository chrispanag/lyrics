import { createContext, useContext } from "react";

/*
 * Whether the catalog pane beside a song is on screen.
 *
 * `ReaderSplit` hides that pane in CSS on a narrow column, so the server and
 * the browser render the same markup. The list inside still mounts, and on a
 * phone opening a song by its address would read the catalog for a pane no
 * one sees. This tells the list whether to ask.
 *
 * False until the browser has measured the column, server render included, so
 * both sides render the same unloaded list. The measurement runs in a layout
 * effect, before the first paint.
 */

/** Defaults to shown, so the catalog loads wherever it has no `ReaderSplit` around it. */
export const CatalogPaneContext = createContext(true);

export function useCatalogPaneShown(): boolean {
  return useContext(CatalogPaneContext);
}
