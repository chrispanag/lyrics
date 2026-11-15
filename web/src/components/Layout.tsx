import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ListMusic, Menu, Search, Shield, User as UserIcon } from "lucide-react";
import {
  type RefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/auth/useAuth";
import { Avatar } from "@/components/Avatar";
import { buttonClasses } from "@/components/buttonStyles";
import { Button, Spinner } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/cn";
import { useHomeEndInside } from "@/lib/modal";
import { NAV_DRAWER_ID, NavDrawerContext, useNavDrawer } from "@/lib/navDrawer";
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

  // Growing past `md` (768px) closes the drawer. The hamburger is `md:hidden`,
  // so an open drawer would keep the page inert, and the song page's swipe and
  // arrow keys standing down, with the only control that opened it gone.
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
 * Scrolls the drawer to its closed stop. `auto` defers to the stylesheet:
 * smooth unless motion is reduced. Marks it leaving, so a slide in still
 * waiting on its frames stands down.
 */
function slideOutOf(track: HTMLElement | null, leaving: RefObject<boolean>) {
  leaving.current = true;
  track?.scrollTo({ left: track.offsetWidth, behavior: "auto" });
}

/**
 * The same navigation on a phone: a modal `<dialog>`, so the browser makes the
 * page inert, moves focus in, closes on Escape and hands focus back.
 *
 * The dialog is also a horizontal scroller with two snap stops, the sheet and
 * a viewport-wide spacer, so the swipe that dismisses it is the browser's own
 * scrolling and follows the finger. Closing is a scroll to the spacer, and the
 * observer below calls `close()` once the sheet is off-screen: a closed dialog
 * is `display: none`, so closing first would cut the slide. Styles are
 * `.nav-drawer` in index.css. See "Frontend" in CLAUDE.md.
 */
function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  // Whether the sheet has been on screen since `showModal()`. Until it has,
  // being off-screen is where it starts, not a dismissal.
  const shown = useRef(false);
  const leaving = useRef(false);
  // WebKit would otherwise send Home and End to the page behind.
  useHomeEndInside(open, dialog);
  const slideOut = () => slideOutOf(dialog.current, leaving);

  // An open dialog is closed before it is unmounted, so `close()` can still
  // hand focus back. A layout cleanup, since that runs before React removes it.
  useLayoutEffect(() => {
    const element = dialog.current;
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  // Once: the observer that closes the dialog, and the dim's fallback.
  useEffect(() => {
    const element = dialog.current;
    const panel = sheet.current;
    if (!element || !panel) return;

    // Any pixel of the sheet still showing counts as open.
    const visible = 1 / window.innerWidth;
    const observer = new IntersectionObserver(
      (entries) => {
        // A programmatic scroll can deliver several; the last is where it is.
        const ratio = entries.at(-1)?.intersectionRatio ?? 0;
        if (ratio >= visible) shown.current = true;
        else if (shown.current && element.open) element.close();
      },
      { root: element, threshold: visible },
    );
    observer.observe(panel);

    // Without scroll-driven animations the stylesheet never writes the dim.
    const fade = () => {
      const progress = 1 - element.scrollLeft / (panel.offsetWidth || 1);
      element.style.setProperty("--drawer-backdrop", String(Math.max(0, progress)));
    };
    if (!CSS.supports("animation-timeline: scroll()")) {
      element.addEventListener("scroll", fade, { passive: true });
    }

    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", fade);
    };
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (!open) {
      // A navigation or the breakpoint rather than the drawer's own dismissal.
      // A sheet that never reached the screen has nothing to slide.
      if (!element.open) return;
      if (shown.current) slideOutOf(element, leaving);
      else element.close();
      return;
    }

    if (element.open) return;
    shown.current = false;
    leaving.current = false;
    element.showModal();
    // `showModal()` focuses the first focusable thing inside, and a link there
    // would scroll the sheet into view before it could slide. The dialog is
    // what a screen reader should land on anyway, being the thing named.
    // `close()` still hands focus to the opener `showModal()` recorded.
    element.focus({ preventScroll: true });

    // `scroll-initial-target` opens the scroller on the closed stop. Without
    // it, it opens on the sheet: jumped to the spacer first, and given two
    // frames to commit, since a scroll in the first would cancel the jump.
    if (CSS.supports("scroll-initial-target", "nearest")) {
      element.scrollTo({ left: 0, behavior: "auto" });
      return;
    }
    element.scrollTo({ left: element.offsetWidth, behavior: "instant" });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!leaving.current) element.scrollTo({ left: 0, behavior: "auto" });
      }),
    );
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is a tap on the dim; the keyboard's way out is Escape.
    <dialog
      ref={dialog}
      id={NAV_DRAWER_ID}
      aria-label="Navigation"
      // Focusable only as the target of `focus()` on opening.
      tabIndex={-1}
      className="nav-drawer outline-none"
      // Every close ends here: the observer's, and an uncancelable Escape's.
      onClose={onClose}
      // Escape slides out rather than vanishing. A repeated Escape with no
      // activation in between is uncancelable and closes at once.
      onCancel={(event) => {
        if (!event.cancelable) return;
        event.preventDefault();
        slideOut();
      }}
      // The dialog fills the viewport, so a tap on the dim lands on the dialog
      // rather than on `::backdrop`. That is also why this is not
      // `closedby="any"`, which would close without the slide.
      onClick={(event) => {
        if (!sheet.current?.contains(event.target as Node)) slideOut();
      }}
    >
      <div
        ref={sheet}
        className="nav-drawer-sheet flex flex-col border-r border-stone-200 bg-white shadow-2xl pt-safe pb-safe dark:border-stone-800 dark:bg-stone-900"
      >
        {/* Padding here, not on the sheet, so it cannot collide with the
            safe-area padding. `min-h-0` lets this scroll, and it always does,
            by the extra pixel inside: iOS Safari honors `overscroll-behavior`
            only on a box that actually scrolls, and a vertical swipe here
            would otherwise scroll the page behind. `-y` only, so a sideways
            swipe still reaches the drawer. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-6">
          <div className="flex min-h-[calc(100%+1px)] flex-col">
            <NavPanel />
          </div>
        </div>
      </div>
    </dialog>
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
      aria-controls={NAV_DRAWER_ID}
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
