import { createContext, useContext } from "react";

/*
 * Whether the phone's navigation drawer is open, and how to open it.
 *
 * Joins the shell's drawer to the header's button. They cannot be one component:
 * `StickyHeader`'s transform makes it the containing block for anything fixed
 * inside it, so a drawer rendered there would slide away with the header.
 */

export interface NavDrawer {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * Defaults to a drawer that cannot be opened, rather than throwing, so page
 * specs can render without `Layout`.
 */
export const NavDrawerContext = createContext<NavDrawer>({
  open: false,
  setOpen: () => {},
});

export function useNavDrawer(): NavDrawer {
  return useContext(NavDrawerContext);
}
