import {
  type ComponentPropsWithoutRef,
  type ComponentType,
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

/*
 * The app's routing seam: every component reaches the router through this
 * module and nothing else, which Biome's `noRestrictedImports` enforces. The
 * router itself is a backend handed in through context — Next's App Router in
 * the app (`lib/nextNavigation.tsx`, mounted by `app/Providers.tsx`), and an
 * in-memory history in specs and stories (`TestRouter` below) — so no spec has
 * to mock `next/navigation`, and what the app promises about history is
 * written here once, above whichever router answers. See CLAUDE.md, "The
 * routing seam".
 */

/** A search string's reading half, which is all `next/navigation` hands out. */
export type ReadonlySearchParams = Omit<URLSearchParams, "append" | "delete" | "set" | "sort">;

/** What a backend's link takes: the seam has already decided `replace`. */
export type BackendLinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
  replace: boolean;
};

/**
 * A router, as the seam needs one: where the reader is, and three ways to move.
 * Navigations here never scroll; `Layout` scrolls to the top on a new pathname,
 * which is the one scroll rule the app has.
 */
export interface NavigationBackend {
  pathname: string;
  searchParams: ReadonlySearchParams;
  params: Readonly<Record<string, string | string[] | undefined>>;
  /** Stable across navigations, as Next's router is. */
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  Link: ComponentType<BackendLinkProps>;
}

const BackendContext = createContext<NavigationBackend | null>(null);

function useBackend(): NavigationBackend {
  const backend = useContext(BackendContext);
  if (!backend) {
    throw new Error("No router: mount NavigationProvider (the app) or TestRouter (specs).");
  }
  return backend;
}

/** The path of the current address, with no search string or hash. */
export function usePathname(): string {
  return useBackend().pathname;
}

export function useSearchParams(): ReadonlySearchParams {
  return useBackend().searchParams;
}

/** The current address as a link would name it: path plus search string. No hash. */
export function useCurrentHref(): string {
  const { pathname, searchParams } = useBackend();
  return withSearch(pathname, searchParams.toString());
}

/** The dynamic segments of the route being rendered, by name. */
export function useParams<T extends Record<string, string>>(): Partial<T> {
  return useBackend().params as Partial<T>;
}

/**
 * Rewrites the search string from what it holds now. `replace` for state that
 * should not grow history, such as a query typed letter by letter.
 *
 * Not referentially stable, exactly as react-router's setter was not: an
 * effect that lists it re-runs after every write, so it needs a guard of its
 * own. A search-string write is not counted as a navigation (`useNavigationKey`,
 * `canGoBack`): it is the screen's own state, kept in the address.
 */
export function useSetSearchParams(): (
  edit: (next: URLSearchParams) => void,
  options?: { replace?: boolean },
) => void {
  const { pathname, searchParams, push, replace } = useBackend();
  return (edit, options = {}) => {
    const next = new URLSearchParams(searchParams.toString());
    edit(next);
    const href = withSearch(pathname, next.toString());
    if (options.replace) replace(href);
    else push(href);
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

/** Stable for as long as the backend's functions are, which is for good. */
export function useRouter(): Router {
  const { push, replace, back } = useBackend();
  const { noteNavigation, canGoBack } = useContext(HistoryContext);

  return useMemo(
    () => ({
      push(href) {
        // A push to the address showing replaces it, as a link to it does:
        // two identical entries in a row make Back appear to do nothing.
        if (noteNavigation(href, "push")) replace(href);
        else push(href);
      },
      replace(href) {
        noteNavigation(href, "replace");
        replace(href);
      },
      back,
      canGoBack,
    }),
    [push, replace, back, noteNavigation, canGoBack],
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
  const { Link: BackendLink } = useBackend();
  const { noteNavigation } = useContext(HistoryContext);
  // Decided here rather than left to the router: a link to the address
  // showing replaces it, whatever the router would have done.
  const same = sameAddress(href, useCurrentHref());

  const onPress = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented && isPlainClick(event)) {
      noteNavigation(href, replace ? "replace" : "push");
    }
  };

  return <BackendLink href={href} replace={Boolean(replace) || same} onClick={onPress} {...rest} />;
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

/**
 * Sends the reader on once rendered, replacing the entry they arrived on. A
 * guard's redirect, decided in the browser: on a server every guard is still
 * waiting for the session, so nothing renders this there.
 */
export function Redirect({ href }: { href: string }) {
  const { replace } = useRouter();
  useEffect(() => replace(href), [replace, href]);
  return null;
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

/**
 * Mounts a backend, and what this module knows about history that no router
 * says: whether anything in the app is behind the current entry, and how many
 * navigations have gone nowhere new. The only way to provide a backend, so no
 * tree has a router without it and quietly answers from the context defaults.
 *
 * `canGoBack` is whether this document has pushed an entry or been moved
 * through history since it loaded — the in-app trail, and nothing else. Not
 * the Navigation API's `canGoBack`, which is also true over an earlier page
 * load of this site: an editor address pasted into a tab already on a song
 * would then pop to that other song after saving. Kept in memory, it reads a
 * reloaded editor as a fresh tab, which is the safe way to be wrong: the editor
 * replaces itself with its own song rather than popping somewhere unrelated.
 */
export function NavigationProvider({
  backend,
  entriesBehind = false,
  children,
}: {
  backend: NavigationBackend;
  entriesBehind?: boolean;
  children: ReactNode;
}) {
  const here = withSearch(backend.pathname, backend.searchParams.toString());
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

  const canGoBack = useCallback(() => movedRef.current, []);

  const value = useMemo(
    () => ({ noteNavigation, canGoBack, revisits }),
    [noteNavigation, canGoBack, revisits],
  );
  return (
    <BackendContext.Provider value={backend}>
      <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>
    </BackendContext.Provider>
  );
}

/**
 * Hands a matched route's dynamic segments to what renders under it, the way
 * Next's `useParams` answers for the page it rendered. For the harness, which
 * matches routes itself (`test/routes.tsx`); the app's backend has them already.
 */
export function RouteParams({
  params,
  children,
}: {
  params: Record<string, string>;
  children: ReactNode;
}) {
  const backend = useBackend();
  const value = useMemo(() => ({ ...backend, params }), [backend, params]);
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>;
}

interface MemoryHistory {
  entries: URL[];
  index: number;
}

/** Resolves `href` the way a browser would from `current`. */
function resolve(href: string, current: URL | undefined): URL {
  return new URL(href, current ?? ORIGIN);
}

const ORIGIN = "http://app.invalid";

/**
 * A router held in memory, for specs and stories: rendered at the last of
 * `entries`, with the rest behind it (oldest first) for a spec that goes Back.
 * Its `back()` moves no browser history, so it fires no `popstate`, exactly as
 * react-router's memory router did.
 */
export function TestRouter({ entries, children }: { entries: string[]; children: ReactNode }) {
  const [history, setHistory] = useState<MemoryHistory>(() => {
    const urls: URL[] = [];
    for (const entry of entries) urls.push(resolve(entry, urls.at(-1)));
    return { entries: urls, index: urls.length - 1 };
  });

  const push = useCallback((href: string) => {
    setHistory(({ entries: urls, index }) => ({
      entries: [...urls.slice(0, index + 1), resolve(href, urls[index])],
      index: index + 1,
    }));
  }, []);
  const replace = useCallback((href: string) => {
    setHistory(({ entries: urls, index }) => ({
      entries: urls.map((url, at) => (at === index ? resolve(href, url) : url)),
      index,
    }));
  }, []);
  const back = useCallback(() => {
    setHistory((current) =>
      current.index > 0 ? { ...current, index: current.index - 1 } : current,
    );
  }, []);

  const here = history.entries[history.index] ?? new URL(ORIGIN);
  const { pathname, search } = here;
  const backend = useMemo<NavigationBackend>(
    () => ({
      pathname,
      searchParams: new URLSearchParams(search),
      params: {},
      push,
      replace,
      back,
      Link: MemoryLink,
    }),
    [pathname, search, push, replace, back],
  );

  return (
    <NavigationProvider backend={backend} entriesBehind={entries.length > 1}>
      {children}
    </NavigationProvider>
  );
}

/** A plain anchor whose plain clicks move the memory history instead. */
function MemoryLink({ href, replace, onClick, ...rest }: BackendLinkProps) {
  const backend = useBackend();
  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !isPlainClick(event)) return;
        event.preventDefault();
        if (replace) backend.replace(href);
        else backend.push(href);
      }}
      {...rest}
    />
  );
}

/** A path with its search string, if it has one. */
function withSearch(pathname: string, search: string): string {
  return search ? `${pathname}?${search}` : pathname;
}

/** Whether two in-app addresses are the same screen, hash aside. */
function sameAddress(href: string, current: string): boolean {
  const a = new URL(href, ORIGIN + current);
  const b = new URL(current, ORIGIN);
  return a.pathname === b.pathname && a.search === b.search;
}
