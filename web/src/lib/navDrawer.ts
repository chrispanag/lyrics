import { createContext, useContext } from "react";

/*
 * Whether the phone's navigation drawer is open, and how to open it.
 *
 * Joins the shell's drawer to the header's button. They cannot be one component:
 * every page renders its own header, so a drawer rendered there would unmount
 * with the page a link in it navigates away from, rather than sliding out over
 * the next one.
 */

/** The drawer's `id`, for the hamburger's `aria-controls`. */
export const NAV_DRAWER_ID = "nav-drawer";

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
