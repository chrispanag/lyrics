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
   * Replaced by the identity card while signed in. A guest keeps the link:
   * `/profile` is the only home of the theme switch.
   */
  identityCard?: boolean;
}

/**
 * The lit and pressable treatments shared by the nav links and the identity
 * card. Only the lit one carries a text color: at rest the card inherits.
 */
const SIDEBAR_ACTIVE = "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200";
const SIDEBAR_HOVER = "hover:bg-stone-100 dark:hover:bg-stone-800";

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Browse", icon: Search },
  { to: "/lists", label: "Lists", icon: ListMusic, authOnly: true },
  { to: "/profile", label: "Profile", icon: UserIcon, identityCard: true },
  // The section, not a screen: NavLink matches on prefix, so it stays lit
  // across the console's screens.
  { to: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

/**
 * App shell: a fixed sidebar from `md` up, and the same navigation behind a
 * hamburger on a phone.
 */
export function Layout() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Route changes start at the top. Keyed on `pathname` so a filter written
  // into the query string does not scroll the catalog.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger, not a value read.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  // Any navigation closes the drawer, before the new screen is drawn. Keyed on
  // the location, not the pathname, so a link to the current screen closes it
  // too.
  const [navKey, setNavKey] = useState(location.key);
  if (navKey !== location.key) {
    setNavKey(location.key);
    setNavOpen(false);
  }

  // Growing past `md` (768px) closes the drawer. The drawer and hamburger are
  // `md:hidden`, so an open but invisible drawer would keep the scroll lock and
  // the modal marking, silently disabling the song page's swipe and arrow keys.
  useEffect(() => {
    const desk = window.matchMedia("(min-width: 768px)");
    const close = (event: MediaQueryListEvent) => {
      if (event.matches) setNavOpen(false);
    };

    desk.addEventListener("change", close);
    return () => desk.removeEventListener("change", close);
  }, []);

  // Memoized so consumers re-render only when the drawer opens or closes.
  const drawer = useMemo(() => ({ open: navOpen, setOpen: setNavOpen }), [navOpen]);

  return (
    <NavDrawerContext.Provider value={drawer}>
      <div className="min-h-dvh md:flex">
        <DesktopSidebar />
        <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />

        {/* Extra bottom room on a phone to clear the home indicator. */}
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
 * Shared by the sidebar and the drawer. Every visibility rule is answered here,
 * not at either call site.
 */
function NavPanel() {
  const { user } = useAuth();

  const links = NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return hasRole(user?.role, "admin");
    if (item.authOnly) return Boolean(user);
    // Only a guest, who has no card, keeps the link.
    if (item.identityCard) return !user;
    return true;
  });

  return (
    <>
      <NavLink to="/" className="mb-8 flex px-2">
        <Wordmark />
      </NavLink>

      {/* The card stays inside the <nav> landmark: it is the way to
          `/profile`. `flex-1` gives the `mt-auto` below room to reach the
          bottom. */}
      <nav className="flex flex-1 flex-col gap-1">
        {links.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? SIDEBAR_ACTIVE : cn(SIDEBAR_HOVER, "text-stone-600 dark:text-stone-400"),
              )
            }
          >
            <item.icon aria-hidden className="size-5" />
            {item.label}
          </NavLink>
        ))}

        <div className="mt-auto px-2 pt-6">
          {user ? (
            // The profile entry, with the links' lit and hover treatments.
            // `-mx-2` lines its background up with the links above.
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
                <p className="text-xs capitalize text-stone-500 dark:text-stone-400">{user.role}</p>
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
 * Stays mounted while closed so it can slide. That costs three things: the
 * dialog marking must apply only while open (or `modalIsOpen()` disables the
 * song page's swipe and arrow keys for good), it must be `inert` while closed,
 * and `pointer-events-none` keeps the invisible backdrop from eating presses.
 * See "Frontend" in CLAUDE.md.
 */
function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  // A focus target is passed because this stays mounted while closed.
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
          // Blur only while open: `backdrop-filter` is a viewport-sized
          // composited layer that would otherwise persist on every page.
          open ? "opacity-100 backdrop-blur-sm" : "opacity-0",
        )}
      />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: `marking` spreads role="dialog" while open. */}
      <div
        ref={panel}
        // Focusable only as `useModal`'s focus target.
        tabIndex={-1}
        {...marking}
        aria-label="Navigation"
        className={cn(
          "absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-2xl outline-hidden",
          "border-r border-stone-200 transition-transform duration-200 pt-safe pb-safe",
          "dark:border-stone-800 dark:bg-stone-900",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Padding here, not on the panel, so it cannot collide with the
            safe-area padding. `min-h-0` lets this scroll. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6">
          <NavPanel />
        </div>
      </div>
    </div>
  );
}

/**
 * Opens the phone's navigation drawer. Rendered by the page's own header bar,
 * since the shell has no row on a phone.
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
 * Hides on scroll down and returns on scroll up, below `md` only: the
 * `max-md:` prefix does that in CSS rather than tracking `matchMedia`, whose
 * answer would have to be kept in step with a window resized across the
 * breakpoint.
 *
 * `pinned` holds it still, for a header with something anchored to it.
 *
 * `mobileOnly` goes on the `<header>` itself, since a bordered box with a
 * hidden child still draws a hairline at a desk.
 *
 * Its height is published as `--sticky-header-height` on `<html>`, which the
 * root's `scroll-padding-top` reads, so a control reached by Tab is scrolled
 * clear of the header rather than to the viewport edge underneath it. Measured
 * rather than written down: the catalog's filter chips change the height, and
 * a `mobileOnly` header at a desk is `display: none` and measures 0.
 */
export function StickyHeader({
  children,
  pinned,
  mobileOnly,
}: {
  children: React.ReactNode;
  pinned?: boolean | undefined;
  mobileOnly?: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const root = document.documentElement.style;
    // `offsetHeight` is the border box, so the safe-area padding counts too.
    const observer = new ResizeObserver(() => {
      root.setProperty("--sticky-header-height", `${header.offsetHeight}px`);
    });
    // Border box here too, or a rotation that changes only the inset is missed.
    observer.observe(header, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.removeProperty("--sticky-header-height");
    };
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    // Only transitions are dispatched; scroll fires at frame rate.
    let current = false;

    const onScroll = () => {
      const y = window.scrollY;
      // Threshold against momentum-scroll jitter.
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
      ref={ref}
      // Read by index.css, which keeps focus inside the header from scrolling.
      data-sticky-header
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
