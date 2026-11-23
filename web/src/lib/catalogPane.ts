import { createContext, useContext } from "react";

/*
 * What `ReaderSplit` tells the pane beside the lyrics: whether it has been on
 * screen, and whether a song is open beside it.
 *
 * `ReaderSplit` hides the pane in CSS beside a song on a narrow column, where
 * the list still mounts but should read nothing until it first shows.
 */

/** Defaults to shown, so the catalog loads wherever it has no `ReaderSplit` around it. */
export const CatalogPaneContext = createContext(true);

export function useCatalogPaneShown(): boolean {
  return useContext(CatalogPaneContext);
}

/**
 * Whether a song is open beside the pane, which then names neither the tab nor
 * the page: the song does. Defaults to none, so a pane with no `ReaderSplit`
 * around it is a page of its own.
 */
export const SongOpenContext = createContext(false);

export function useSongOpen(): boolean {
  return useContext(SongOpenContext);
}
