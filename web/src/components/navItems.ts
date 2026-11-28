import { useQueryClient } from "@tanstack/react-query";
import { Disc3, ListMusic, Search, Shield, User as UserIcon } from "lucide-react";
import { useCallback } from "react";

import { queries } from "@/api/hooks";
import { songSection } from "@/lib/listContext";
import { pathMatches } from "@/lib/navigation";
import { hasRole, type User } from "@/lib/types";
import { useIntentPrefetch } from "@/lib/useIntentPrefetch";

/*
 * The navigation's entries, shared by the rail from `md` up and the bottom
 * bar below it, so the two offer the same screens to the same readers and
 * light the same one.
 */

export interface NavItem {
  to: string;
  label: string;
  icon: typeof Search;
  /** The bottom bar's icon, where the column's would clash with its Search button. */
  barIcon?: typeof Search;
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

const BROWSE: NavItem = {
  to: "/",
  label: "Browse",
  icon: Search,
  // A magnifier beside the bar's Search button would be two of the same mark
  // for two different things. The brand's mark instead, which leads home from
  // the top of a desk's rail too, drawn in the tab's own color.
  barIcon: Disc3,
};

const PROFILE: NavItem = { to: "/profile", label: "Profile", icon: UserIcon, identityCard: true };

/**
 * The console's entry. The section, not a screen: entries match on prefix, so
 * it stays lit across the console's screens. A phone reaches it from Profile.
 */
export const ADMIN_ITEM: NavItem = { to: "/admin", label: "Admin", icon: Shield, adminOnly: true };

export const NAV_ITEMS: NavItem[] = [
  BROWSE,
  { to: "/lists", label: "Lists", icon: ListMusic, authOnly: true, warmsLists: true },
  PROFILE,
  ADMIN_ITEM,
];

/** Whether `item` is offered to `user` at all, whatever draws it. */
export function offeredTo(item: NavItem, user: User | null): boolean {
  if (item.adminOnly) return hasRole(user?.role, "admin");
  if (item.authOnly) return Boolean(user);
  return true;
}

/**
 * The entries `user` is offered on the column, or on a phone's bottom bar
 * (`phone`), which has no Admin tab: a phone reaches the console from Profile.
 */
export function offeredEntries(user: User | null, { phone }: { phone: boolean }): NavItem[] {
  return NAV_ITEMS.filter((item) => offeredTo(item, user) && !(phone && item.adminOnly));
}

/**
 * The entry the reader is in, which the column and the bottom bar light and
 * the bar's pill names, so the three cannot disagree.
 *
 * A song has no entry of its own: it belongs to the list beside it
 * (`songSection`). A phone has no Admin tab, so there the console belongs to
 * Profile, from which a phone reaches it. Anywhere no entry claims (a song's
 * editor, an address that names nothing) is Browse, the catalog every other
 * screen leads back to: the pill must always say something, and the lit tab
 * must be what it says.
 *
 * Undefined for a song read from a list the reader has no entry for (a guest,
 * who is offered no Lists): the pill names that list, so lighting Browse would
 * say something else, and no entry is lit.
 */
export function currentEntry(
  pathname: string,
  searchParams: Pick<URLSearchParams, "get">,
  user: User | null,
  { phone }: { phone: boolean },
): NavItem | undefined {
  const offered = offeredEntries(user, { phone });
  const section = songSection(pathname, searchParams);
  const claimed =
    section ?? (phone && pathMatches(pathname, ADMIN_ITEM.to) ? PROFILE.to : pathname);
  const entry = offered.find((item) => pathMatches(claimed, item.to));
  if (entry) return entry;
  return section && section !== BROWSE.to ? undefined : BROWSE;
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
