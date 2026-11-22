import { createContext, useContext } from "react";

/*
 * Whether the catalog pane is on screen. `ReaderSplit` hides it in CSS beside a
 * song on a narrow column, where the list still mounts but should read nothing.
 */

/** Defaults to shown, so the catalog loads wherever it has no `ReaderSplit` around it. */
export const CatalogPaneContext = createContext(true);

export function useCatalogPaneShown(): boolean {
  return useContext(CatalogPaneContext);
}
