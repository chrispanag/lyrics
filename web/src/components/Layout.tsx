import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ListMusic, Search, Shield, User as UserIcon } from "lucide-react";
import { Suspense, useEffect, useState } from "react";

import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { buttonClasses } from "@/components/buttonStyles";
import { Spinner } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";
import { hasRole } from "@/lib/types";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Search;
  /** Only shown when signed in. */
  authOnly?: boolean;
  adminOnly?: boolean;
  /**
   * Rendered by the sidebar as the identity card at its foot, rather than as
   * one of the links above it — and only while there is an identity to render.
   *
   * A guest gets the Sign in button where the card would be, so a guest keeps
   * the link: the tab bar is `md:hidden`, and `/profile` is where the theme
   * switch lives and nowhere else, so dropping the entry whatever the reader is
   * leaves a signed-out one at a desk with no route to that screen at all.
   * Nothing says so from a signed-in sidebar, which has its card.
   *
   * The phone is the other half of the same rule, and is why the item is not
   * `authOnly`: the bar has no card, and no sign-in button either, so this
   * entry is the only route it has to `/profile` and through it to signing in.
   *
   * Unlike the two flags above, this one is honored by the surface that renders
   * its own version of the entry — a third navigation gets the entry unless it
   * says otherwise, since there is nothing here that could withhold it.
   */
  identityCard?: boolean;
}

/**
 * The lit and pressable treatments the sidebar's links share with the identity
 * card standing in for one of them.
 *
 * Tokens rather than two copies: nothing pins the two agreeing, so retuning
 * either on the links would otherwise be a change to make twice.
 *
 * The lit one carries its text color and the pressable one does not, which is
 * the asymmetry between the two call sites and not an oversight: lit, both the
 * label and the card's name take the brand color, while at rest the links state
 * a stone the card leaves to inherit. The card's role line names its own stone
 * either way, so it stays put under both.
 */
const SIDEBAR_ACTIVE = "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200";
const SIDEBAR_HOVER = "hover:bg-stone-100 dark:hover:bg-stone-800";

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Browse", icon: Search },
  { to: "/lists", label: "Lists", icon: ListMusic, authOnly: true },
  { to: "/profile", label: "Profile", icon: UserIcon, identityCard: true },
  // The console's own section rather than one of its screens: a NavLink matches
  // on prefix, so this stays lit while an admin moves between users and genres,
  // and `/admin` redirects to the first of them.
  { to: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

/**
 * App shell: a bottom tab bar on phones and a fixed sidebar from `md` up.
 *
 * The two navigations are separate elements rather than one responsive list
 * because they differ in more than layout — the bar is icon-first and thumb
 * reachable, the sidebar is label-first and shows the signed-in identity.
 */
export function Layout() {
  const { user } = useAuth();
  const location = useLocation();

  const visible = NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return hasRole(user?.role, "admin");
    if (item.authOnly) return Boolean(user);
    return true;
  });

  // Route changes should start at the top; without this, navigating from
  // halfway down a search results page lands mid-lyrics on the next screen.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  return (
    <div className="min-h-dvh md:flex">
      <DesktopSidebar items={visible} />

      {/* pb-24 clears the fixed tab bar on mobile. */}
      <main className="min-w-0 flex-1 pb-24 md:pb-8">
        {/* One boundary for every lazy route, rather than one per route element.
            The shell stays mounted while a chunk loads. */}
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>

      <MobileTabBar items={visible} />
    </div>
  );
}

function DesktopSidebar({ items }: { items: NavItem[] }) {
  const { user } = useAuth();

  // Asked here rather than by the caller: whether the card at the foot stands
  // in for an entry is this navigation's own question, and it answers yes only
  // while there is a card. Asked from outside, the next reader of this
  // component gets the link *and* the card, both pointing at `/profile`.
  const links = user ? items.filter((item) => !item.identityCard) : items;

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-stone-200 bg-white px-4 py-6 md:flex dark:border-stone-800 dark:bg-stone-900">
      <NavLink to="/" className="mb-8 flex px-2">
        <Wordmark />
      </NavLink>

      {/* The card and the Sign in button are inside the landmark, not beside
          it: whichever of them is rendered is this navigation's only way to
          `/profile`, and left outside, a reader navigating by landmark finds
          Browse, Lists and Admin and no route to their own profile. `flex-1` is
          what keeps that free — it gives the nav the height the aside was
          holding, so the `mt-auto` below still has the room to push itself to
          the bottom of the sidebar rather than to the foot of the links. */}
      <nav className="flex flex-1 flex-col gap-1">
        {links.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? SIDEBAR_ACTIVE
                  : cn(SIDEBAR_HOVER, "text-stone-600 dark:text-stone-400"),
              )
            }
          >
            <item.icon aria-hidden className="size-5" />
            {item.label}
          </NavLink>
        ))}

        <div className="mt-auto px-2 pt-6">
          {user ? (
            // The sidebar's profile entry, which is why the list above drops it.
            // It takes the links' own treatments: without the lit one the
            // profile screen is the one place in the app where nothing in the
            // sidebar is lit, and without the hover one — the link being gone —
            // nothing says the card can be pressed. `-mx-2` against its own
            // padding widens the background out to the aside's inner edge, so it
            // lines up with those entries while the card's contents stay where
            // they were.
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                cn(
                  "-mx-2 flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 transition-colors",
                  isActive ? SIDEBAR_ACTIVE : SIDEBAR_HOVER,
                )
              }
            >
              <Avatar user={user} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user.display_name ?? user.email}</p>
                <p className="text-xs capitalize text-stone-500 dark:text-stone-400">
                  {user.role}
                </p>
              </div>
            </NavLink>
          ) : (
            <NavLink to="/login" className={cn(buttonClasses("primary", "md"), "w-full")}>
              Sign in
            </NavLink>
          )}
        </div>
      </nav>
    </aside>
  );
}

function MobileTabBar({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur pb-safe md:hidden dark:border-stone-800 dark:bg-stone-900/95"
    >
      <div className="flex">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                // min-h-14 keeps the tap target comfortable regardless of label length.
                "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors",
                isActive ? "text-brand-600 dark:text-brand-400" : "text-stone-500 dark:text-stone-400",
              )
            }
          >
            <item.icon aria-hidden className="size-5" />
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/**
 * A sticky page header that gets out of the way on a phone.
 *
 * It hides as the reader scrolls down and returns on the way up, which is what
 * gives lyrics the full height of a phone screen while keeping search one
 * gesture away. Only on a phone, though: the hiding is scoped to `max-md`, since
 * a desk has the height to spare and a header that comes and goes under the
 * pointer is movement in exchange for nothing. The scroll listener still runs
 * there — the class it toggles is simply a no-op above the breakpoint — rather
 * than asking `matchMedia` and then keeping that answer in step with a window
 * that can be dragged across the breakpoint at any time.
 *
 * `pinned` holds it still regardless, and what needs that is a header with
 * something hanging off it: the song page's search results are anchored to this
 * box, so a header that slid away would take the results with it. On iOS,
 * focusing a field can scroll the page by itself — which is exactly the movement
 * this reads as "scrolling down to the lyrics".
 */
export function StickyHeader({
  children,
  pinned,
}: {
  children: React.ReactNode;
  pinned?: boolean;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    // Scroll fires at frame rate and most deltas clear the threshold, so
    // dispatching on every one of them meant ~60 state updates a second to
    // re-assert a value that had not changed. Only transitions are dispatched.
    let current = false;

    const onScroll = () => {
      const y = window.scrollY;
      // The 8px threshold stops the header from flickering on the small
      // scroll jitter that momentum scrolling produces.
      if (Math.abs(y - lastY) > 8) {
        const next = y > lastY && y > 80;
        if (next !== current) {
          current = next;
          setHidden(next);
        }
        lastY = y;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-stone-200 bg-stone-50/90 backdrop-blur transition-transform duration-200 pt-safe dark:border-stone-800 dark:bg-stone-950/90",
        hidden && !pinned && "max-md:-translate-y-full",
      )}
    >
      {children}
    </header>
  );
}
