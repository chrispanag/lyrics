import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ListMusic, Menu, Search, Shield, User as UserIcon } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { buttonClasses } from "@/components/buttonStyles";
import { Button, Spinner } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";
import { useModal } from "@/lib/modal";
import { NavDrawerContext, useNavDrawer } from "@/lib/navDrawer";
import { hasRole } from "@/lib/types";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Search;
  /** Only shown when signed in. */
  authOnly?: boolean;
  adminOnly?: boolean;
  /**
   * Rendered as the identity card at the foot of the navigation rather than as
   * one of the links above it — and only while there is an identity to render.
   *
   * A guest gets the Sign in button where the card would be, so a guest keeps
   * the link: `/profile` is where the theme switch lives and nowhere else, so
   * dropping the entry whatever the reader is leaves a signed-out visitor with
   * no route to that screen at all, and through it no second route to signing
   * in. Nothing says so from a signed-in navigation, which has its card.
   *
   * Both navigations render the same panel, so this is answered once for the
   * sidebar and the phone's drawer together — which is the whole of why the
   * drawer replaced the tab bar rather than being written beside one. A third
   * navigation gets the entry unless it says otherwise, since there is nothing
   * here that could withhold it.
   */
  identityCard?: boolean;
}

/**
 * The lit and pressable treatments the navigation's links share with the
 * identity card standing in for one of them.
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
 * App shell: a fixed sidebar from `md` up, and the same navigation behind a
 * hamburger on a phone.
 *
 * The drawer replaced a bottom tab bar, and vertical room is what it bought:
 * the bar stood over the last 96px of every screen for as long as the app was
 * open, which on a phone is a stanza of lyrics. What the two surfaces show is
 * now one panel rather than two lists that happened to agree — the tab bar had
 * no identity card and no way to sign in, and each of those was a rule someone
 * editing `NAV_ITEMS` had to keep in mind.
 */
export function Layout() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Route changes should start at the top; without this, navigating from
  // halfway down a search results page lands mid-lyrics on the next screen.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  // Going somewhere is the whole point of the drawer, so arriving closes it.
  // Keyed on the location rather than on its pathname — the entry a link pushes
  // is a new location whether or not the path changed, and a reader who presses
  // the screen they are already on would otherwise be left looking at a drawer
  // with nothing having happened. Its own effect rather than a line in the one
  // above, whose `pathname` key is deliberate: a filter written into the
  // catalog's query string must not scroll that page back to the top.
  useEffect(() => {
    setNavOpen(false);
  }, [location]);

  // A window too wide for the drawer closes it, and this is the one thing about
  // it that is not cosmetic. Both the panel and the hamburger are `md:hidden`,
  // so growing past the breakpoint takes the whole control off the screen while
  // `navOpen` goes on saying it is open — and an open drawer nobody can see
  // still costs everything an open modal costs. The scroll lock freezes a desk's
  // page with no modal on it, and `modalIsOpen()` asks the DOM for the marking
  // rather than asking what is visible, so the song page's paging swipe and its
  // arrow keys stand down for the rest of the session. A phone turned to
  // landscape is 812px or more, so that is one rotation away rather than a
  // resize nobody performs.
  //
  // This is deliberately a one-way close rather than a rendered answer, which is
  // why it does not contradict `StickyHeader`'s reason for refusing
  // `matchMedia`: that one keeps a *class* in step with a window and hands the
  // job to CSS, while here the state itself has to change once the control that
  // owns it is gone. 768px is Tailwind's `md`, the breakpoint both of those
  // `md:hidden`s name. Nothing has to run on mount — `navOpen` starts false and
  // only the hamburger, which is hidden above `md`, can set it.
  useEffect(() => {
    const desk = window.matchMedia("(min-width: 768px)");
    const close = (event: MediaQueryListEvent) => {
      if (event.matches) setNavOpen(false);
    };

    desk.addEventListener("change", close);
    return () => desk.removeEventListener("change", close);
  }, []);

  // Memoized so the hamburger — this context's one consumer, and there is one
  // per screen — re-renders when the drawer opens and closes, rather than on
  // every render of the shell, which a fresh object literal makes of every
  // navigation and every filter written into the catalog's query string.
  const drawer = useMemo(() => ({ open: navOpen, setOpen: setNavOpen }), [navOpen]);

  return (
    <NavDrawerContext.Provider value={drawer}>
      <div className="min-h-dvh md:flex">
        <DesktopSidebar />
        <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />

        {/* The tab bar took its `pb-safe` with it, so the last thing on a page
            has to clear the home indicator on its own — hence more room here
            than a desk needs, and still a third of what a fixed bar cost. */}
        <main className="min-w-0 flex-1 pb-12 md:pb-8">
          {/* One boundary for every lazy route, rather than one per route element.
              The shell stays mounted while a chunk loads. */}
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </NavDrawerContext.Provider>
  );
}

/**
 * The navigation itself: the wordmark, the links, and the identity card or the
 * Sign in button at its foot.
 *
 * Shared by the sidebar and the drawer, which differ only in how they are placed
 * on the screen. Written twice instead, the `identityCard` rule above would be a
 * rule to apply twice — and the phone's copy is the one that was missing it,
 * having been a row of icons with no card on it and no way in.
 *
 * All three of the visibility rules are answered here rather than the two role
 * ones being answered by the shell and the third by the panel. Which entries a
 * navigation shows is one question, and split across two components it is a
 * question a reader has to find the other half of — the same argument
 * `identityCard` makes above for not asking it from outside at all.
 */
function NavPanel() {
  const { user } = useAuth();

  const links = NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return hasRole(user?.role, "admin");
    if (item.authOnly) return Boolean(user);
    // The card at the foot stands in for this entry, but only while there is a
    // card: a guest gets the Sign in button in its place and keeps the link.
    if (item.identityCard) return !user;
    return true;
  });

  return (
    <>
      <NavLink to="/" className="mb-8 flex px-2">
        <Wordmark />
      </NavLink>

      {/* The card and the Sign in button are inside the landmark, not beside
          it: whichever of them is rendered is this navigation's only way to
          `/profile`, and left outside, a reader navigating by landmark finds
          Browse, Lists and Admin and no route to their own profile. `flex-1` is
          what keeps that free — it gives the nav the height the container was
          holding, so the `mt-auto` below still has the room to push itself to
          the bottom rather than to the foot of the links. */}
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
            // The navigation's profile entry, which is why the list above drops
            // it. It takes the links' own treatments: without the lit one the
            // profile screen is the one place in the app where nothing in the
            // navigation is lit, and without the hover one — the link being
            // gone — nothing says the card can be pressed. `-mx-2` against its
            // own padding widens the background out to the container's inner
            // edge, so it lines up with those entries while the card's contents
            // stay where they were.
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
    </>
  );
}

function DesktopSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-stone-200 bg-white px-4 py-6 md:flex dark:border-stone-800 dark:bg-stone-900">
      <NavPanel />
    </aside>
  );
}

/**
 * The same navigation on a phone, slid in over the page.
 *
 * It overlays rather than pushing the page aside, which is what keeps opening it
 * free of any layout work at all: nothing underneath moves, so a long song is not
 * re-laid-out behind a panel that is about to close again.
 *
 * Three things here are load-bearing and none of them is the animation.
 *
 * It stays **mounted while closed**, because a panel that unmounts cannot slide
 * back out — the transform is what is animated, and there is nothing to
 * transition from once the element is gone. Everything below is what that costs.
 *
 * It carries `role="dialog"` and `aria-modal` **only while it is open**, and that
 * is not a cosmetic detail: `lib/modal.ts` asks the DOM whether a modal is up, by
 * exactly that pair of attributes and never by whether anything is visible. Left
 * on a closed drawer they sit on the page for the whole session, so the song
 * page's paging swipe and its arrow keys stand down permanently — on phones only,
 * silently, and with the drawer itself looking perfectly well behaved.
 *
 * And it is `inert` while closed, so the links inside are out of the tab order
 * and out of the accessibility tree rather than being a second copy of the
 * navigation that a keyboard reaches through the page. `pointer-events-none` says
 * as much to a browser that does not know `inert`, and is what keeps an invisible
 * backdrop from swallowing every press on the page behind it.
 */
function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  // Escape, the scroll lock, the focus, and the marking — the same `lib/modal.ts`
  // the sheet uses, which is what keeps the two from being two answers to what a
  // modal is. The focus target is passed because this one stays mounted: there
  // is no unmount to leave the reader outside, so it has to be sent in.
  const marking = useModal({ open, onClose, focus: panel });

  return (
    <div
      className={cn("fixed inset-0 z-50 md:hidden", !open && "pointer-events-none")}
      inert={!open}
    >
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-200",
          // The blur goes with the state rather than riding along at zero
          // opacity: `backdrop-filter` makes this a composited layer the size
          // of the viewport, and on a phone that would be one on every page for
          // as long as the app is open. It drops the moment the drawer starts
          // closing rather than fading with the wash, which is a difference
          // nobody can see behind 40% black on its way out.
          open ? "opacity-100 backdrop-blur-sm" : "opacity-0",
        )}
      />
      <div
        ref={panel}
        // Focusable only as a target for `useModal`: a dialog that opens with
        // focus left outside it is one a keyboard reader has to go looking for,
        // and this is the element whose label announces the drawer.
        tabIndex={-1}
        {...marking}
        aria-label="Navigation"
        className={cn(
          "absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-2xl outline-none",
          "border-r border-stone-200 transition-transform duration-200 pt-safe pb-safe",
          "dark:border-stone-800 dark:bg-stone-900",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* The padding is in here rather than on the panel because the safe-area
            insets above are padding too, and `cn` is a plain join: `py-6` and
            `pt-safe` would both land in the class list with source order picking
            the winner. `min-h-0` is what lets this scroll inside a column that is
            exactly as tall as the screen. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6">
          <NavPanel />
        </div>
      </div>
    </div>
  );
}

/**
 * Opens the phone's navigation drawer.
 *
 * Rendered by the app bars rather than by the shell, because the shell has no row
 * of its own on a phone: the header a page already carries is where this has to
 * go, or the drawer costs back the vertical room the tab bar was removed to
 * reclaim. `md:hidden` because the sidebar is the navigation from `md` up, and a
 * hidden flex child takes no part in its row's `gap` — so nothing about the search
 * box beside it moves at a desk.
 */
export function MenuButton() {
  const { open, setOpen } = useNavDrawer();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setOpen(true)}
      aria-label="Open menu"
      aria-expanded={open}
      className="shrink-0 md:hidden"
    >
      <Menu aria-hidden className="size-5" />
    </Button>
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
 *
 * `mobileOnly` is for a header that exists to carry the hamburger and nothing
 * else — see `MenuHeader`. It belongs on the `<header>` rather than on whatever
 * a caller puts inside, because a bordered box with a hidden child is still a
 * bordered box: a hairline across the top of every screen at a desk, where the
 * sidebar is the navigation and there is nothing for this bar to hold.
 */
export function StickyHeader({
  children,
  pinned,
  mobileOnly,
}: {
  children: React.ReactNode;
  pinned?: boolean;
  mobileOnly?: boolean;
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
        mobileOnly && "md:hidden",
      )}
    >
      {children}
    </header>
  );
}
