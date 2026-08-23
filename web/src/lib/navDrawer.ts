import { createContext, useContext } from "react";

/*
 * Whether the phone's navigation drawer is open, and how to open it.
 *
 * The trigger and the drawer cannot be one component. The drawer is a fixed
 * overlay and the button sits inside `StickyHeader`, whose transform and
 * backdrop filter each make that header the containing block for anything fixed
 * within it — so a drawer rendered from the button would be positioned against
 * the header and slide off the top of the screen with it. The shell renders the
 * drawer, the header renders the button, and this is what joins them.
 *
 * Its own module rather than an export of `Layout`, because a component file
 * exports only components — see CLAUDE.md.
 */

export interface NavDrawer {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * A drawer that is never open and cannot be opened, which is what a header
 * rendered outside the shell gets.
 *
 * That is a spec, not a screen: every page's own tests render the page without
 * `Layout` above it, and the app has no route to any of these pages that does
 * not go through it. Throwing instead would make the shell something every one
 * of those specs has to mount to say anything about a search box.
 */
export const NavDrawerContext = createContext<NavDrawer>({
  open: false,
  setOpen: () => {},
});

export function useNavDrawer(): NavDrawer {
  return useContext(NavDrawerContext);
}
