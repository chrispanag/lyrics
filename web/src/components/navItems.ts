import { useQueryClient } from "@tanstack/react-query";
import { ListMusic, Search, Shield, User as UserIcon } from "lucide-react";
import { useCallback } from "react";

import { queries } from "@/api/hooks";
import { hasRole, type User } from "@/lib/types";
import { useIntentPrefetch } from "@/lib/useIntentPrefetch";

/*
 * The navigation's entries, shared by the sidebar from `md` up and the bottom
 * bar below it, so the two offer the same screens to the same readers and
 * light the same one.
 */

export interface NavItem {
  to: string;
  label: string;
  icon: typeof Search;
  /** Only shown when signed in. */
  authOnly?: boolean;
  adminOnly?: boolean;
  /**
   * Replaced by the identity card while signed in. A guest keeps the link:
   * `/profile` is the only home of the theme switch.
   */
  identityCard?: boolean;
  /** Loads the reader's lists on intent, so the screen opens with them. */
  warmsLists?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Browse", icon: Search },
  { to: "/lists", label: "Lists", icon: ListMusic, authOnly: true, warmsLists: true },
  { to: "/profile", label: "Profile", icon: UserIcon, identityCard: true },
  // The section, not a screen: NavLink matches on prefix, so it stays lit
  // across the console's screens.
  { to: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

/** Whether `item` is offered to `user` at all, whatever draws it. */
export function offeredTo(item: NavItem, user: User | null): boolean {
  if (item.adminOnly) return hasRole(user?.role, "admin");
  if (item.authOnly) return Boolean(user);
  return true;
}

/**
 * Handlers that start loading the reader's lists on hover, press or focus,
 * for a link to them: the lists otherwise wait for the click and show
 * placeholders until they land. Only a signed-in reader is offered such a link.
 */
export function useWarmLists() {
  const queryClient = useQueryClient();
  const prefetch = useCallback(() => {
    void queryClient.prefetchQuery(queries.lists());
  }, [queryClient]);
  return useIntentPrefetch(prefetch);
}
