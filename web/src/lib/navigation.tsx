// biome-ignore-all lint/style/noRestrictedImports: the one module that wraps the router.
import {
  type ComponentPropsWithoutRef,
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BrowserRouter,
  MemoryRouter,
  Navigate,
  Link as RouterLink,
  useLocation,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
  useNavigate,
} from "react-router-dom";

/*
 * The app's routing seam: every component reaches the router through this
 * module and nothing else, which Biome's `noRestrictedImports` enforces. Each
 * export is shaped like what `next/navigation` and `next/link` can implement
 * too — addresses are strings, there is no `location.state` and no
 * `location.key`, and Back is `back()` rather than `navigate(-1)` — so moving
 * the app onto the App Router replaces this module's insides and nothing that
 * imports it. See CLAUDE.md, "The routing seam".
 */

/** A search string's reading half, which is all `next/navigation` hands out. */
export type ReadonlySearchParams = Omit<URLSearchParams, "append" | "delete" | "set" | "sort">;

/** The path of the current address, with no search string or hash. */
export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): ReadonlySearchParams {
  return useRouterSearchParams()[0];
}

/** The current address as a link would name it: path plus search string. No hash. */
export function useCurrentHref(): string {
  const { pathname, search } = useLocation();
  return pathname + search;
}

/** The dynamic segments of the route being rendered, by name. */
export function useParams<T extends Record<string, string>>(): Partial<T> {
  return useRouterParams() as Partial<T>;
}

/**
 * Rewrites the search string from what it holds now. `replace` for state that
 * should not grow history, such as a query typed letter by letter.
 *
 * Not referentially stable, exactly as react-router's setter is not: an effect
 * that lists it re-runs after every write, so it needs a guard of its own.
 */
export function useSetSearchParams(): (
  edit: (next: URLSearchParams) => void,
  options?: { replace?: boolean },
) => void {
  const [, setParams] = useRouterSearchParams();
  return (edit, options = {}) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        edit(next);
        return next;
      },
      { replace: Boolean(options.replace) },
    );
  };
}

export interface Router {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  /**
   * Whether `back()` stays in this app. False for an address opened in a fresh
   * tab, where there is nothing behind it and Back would leave the site.
   */
  canGoBack(): boolean;
}

/** Stable for as long as react-router's `navigate` is, which is per pathname. */
export function useRouter(): Router {
  const navigate = useNavigate();
  const { noteNavigation, canGoBack } = useContext(HistoryContext);

  return useMemo(
    () => ({
      push(href) {
        // A push to the address showing replaces it, as a link to it does:
        // two identical entries in a row make Back appear to do nothing.
        const same = noteNavigation(href, "push");
        // Typed to allow a promise, which only a data router returns.
        void navigate(href, { replace: same });
      },
      replace(href) {
        noteNavigation(href, "replace");
        void navigate(href, { replace: true });
      },
      back() {
        void navigate(-1);
      },
      canGoBack,
    }),
    [navigate, noteNavigation, canGoBack],
  );
}

/**
 * Changes on every in-app navigation, including one to the address already
 * showing — a link to the current screen, or a search result that is the song
 * already open. Whatever the reader leaves behind is reset on it.
 *
 * Built from the address plus a count of those same-address navigations, which
 * this module sees because every link and `push`/`replace` goes through it. It
 * misses only Back or Forward between two entries with the same address, which
 * nothing in the app creates.
 */
export function useNavigationKey(): string {
  return `${useCurrentHref()}#${useContext(HistoryContext).revisits}`;
}

type LinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
  /** Replace this history entry rather than push one. */
  replace?: boolean | undefined;
};

/** A link inside the app. `href` is a path, with a search string if it needs one. */
export function Link({ href, replace, onClick, ...rest }: LinkProps) {
  const { noteNavigation } = useContext(HistoryContext);

  const onPress = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented && isPlainClick(event)) {
      noteNavigation(href, replace ? "replace" : "push");
    }
  };

  return (
    <RouterLink
      to={href}
      {...(replace === undefined ? {} : { replace })}
      onClick={onPress}
      {...rest}
    />
  );
}

/**
 * Whether the browser leaves this click to the page: the main button, no
 * modifier asking for a new tab or window, and no other target.
 */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  const target = event.currentTarget.getAttribute("target");
  return (
    event.button === 0 &&
    !(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) &&
    (!target || target === "_self")
  );
}

/**
 * Whether a link to `href` names the screen at `pathname`: the same path, or one
 * below it by whole segments (`/admin` lights on `/admin/users`, never on
 * `/admin-x`). `/` matches only itself, or it would be lit everywhere.
 */
export function pathMatches(pathname: string, href: string): boolean {
  const here = pathname.toLowerCase();
  const to = href.toLowerCase();
  if (here === to) return true;
  return to !== "/" && here.startsWith(`${to}/`);
}

/**
 * A link that knows when it names the current screen, for navigation: lit
 * through `className`, and announced with `aria-current="page"`.
 */
export function NavLink({
  href,
  className,
  ...rest
}: Omit<LinkProps, "className"> & {
  className: (state: { isActive: boolean }) => string;
}) {
  const isActive = pathMatches(usePathname(), href);
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={className({ isActive })}
      {...rest}
    />
  );
}

/** Sends the reader on while rendering, replacing the entry they arrived on. */
export function Redirect({ href }: { href: string }) {
  return <Navigate to={href} replace />;
}

interface HistoryState {
  /** Records a navigation about to happen; true when it goes to the address showing. */
  noteNavigation(href: string, kind: "push" | "replace"): boolean;
  canGoBack(): boolean;
  /** How many navigations have landed on the address already showing. */
  revisits: number;
}

const HistoryContext = createContext<HistoryState>({
  noteNavigation: () => false,
  canGoBack: () => false,
  revisits: 0,
});

/** The Navigation API, where the browser has one. Not in the DOM typings yet. */
interface NavigationApi {
  canGoBack: boolean;
}

/**
 * What this module knows about history that the router does not say: whether
 * anything in the app is behind the current entry, and how many navigations
 * have gone nowhere new. Mounted once, just inside the router.
 *
 * `canGoBack` asks the browser's Navigation API where there is one: it lists
 * this origin's entries in the tab, so it is right after a reload too, which
 * nothing kept in memory can be. Elsewhere — and in jsdom — it falls back to
 * whether this page has pushed an entry or been moved through history since it
 * loaded, which reads a reloaded editor as a fresh tab. That is the safe way to
 * be wrong: the editor then replaces itself with the song rather than popping
 * an entry that might be another site.
 *
 * Mounted by `AppRouter` and `TestRouter`, never on its own, so no tree can have
 * the router without it and quietly answer from the context's defaults.
 */
function HistoryProvider({
  entriesBehind = false,
  children,
}: {
  entriesBehind?: boolean;
  children: ReactNode;
}) {
  const here = useCurrentHref();
  const hereRef = useRef(here);
  const movedRef = useRef(entriesBehind);
  const [revisits, setRevisits] = useState(0);

  useEffect(() => {
    hereRef.current = here;
  }, [here]);

  // Back or Forward from inside the page means there is history to go to.
  useEffect(() => {
    const moved = () => {
      movedRef.current = true;
    };
    window.addEventListener("popstate", moved);
    return () => window.removeEventListener("popstate", moved);
  }, []);

  const noteNavigation = useCallback((href: string, kind: "push" | "replace") => {
    // A navigation to the address showing replaces its entry rather than
    // adding one, whether a link or a push asked for it.
    const same = sameAddress(href, hereRef.current);
    if (same) setRevisits((count) => count + 1);
    else if (kind === "push") movedRef.current = true;
    return same;
  }, []);

  const canGoBack = useCallback(() => {
    const navigation = (window as { navigation?: NavigationApi }).navigation;
    return navigation ? navigation.canGoBack : movedRef.current;
  }, []);

  const value = useMemo(
    () => ({ noteNavigation, canGoBack, revisits }),
    [noteNavigation, canGoBack, revisits],
  );
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

/** The app's router, on the browser's address bar. Mounted once, by `AppRoot`. */
export function AppRouter({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <HistoryProvider>{children}</HistoryProvider>
    </BrowserRouter>
  );
}

/**
 * A router held in memory, for specs and stories: rendered at the last of
 * `entries`, with the rest behind it (oldest first) for a spec that goes Back.
 */
export function TestRouter({ entries, children }: { entries: string[]; children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={entries}>
      <HistoryProvider entriesBehind={entries.length > 1}>{children}</HistoryProvider>
    </MemoryRouter>
  );
}

/** Whether two in-app addresses are the same screen, hash aside. */
function sameAddress(href: string, current: string): boolean {
  const base = "http://app.invalid";
  const a = new URL(href, base + current);
  const b = new URL(current, base);
  return a.pathname === b.pathname && a.search === b.search;
}
