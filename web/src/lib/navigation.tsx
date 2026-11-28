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
  /** Only ever `false`: a router that prefetches by default is told not to. */
  prefetch?: false | undefined;
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
  /**
   * The address as it is now, path plus search string: read when asked, unlike
   * `pathname` and `searchParams`, which are the last render's. See
   * `useSetSearchParams`.
   *
   * Promised only to include every `writeSearch` already made. A `push`,
   * `replace` or `back` may not show here until it lands: Next moves the
   * address when the new route commits, and `back` waits for `popstate`, while
   * `TestRouter` moves at once. Nothing may rely on either answer.
   */
  liveHref(): string;
  /**
   * Writes a new search string for the path showing. Its own method because a
   * router may do it more cheaply than a navigation: Next's re-renders the
   * route on the server for a push, which the screen's own state never needs.
   */
  writeSearch(href: string, options: { replace: boolean }): void;
  /**
   * Loads a destination whole before anything navigates to it, so the step
   * paints at once. A hint: a router with nothing to load ignores it.
   */
  prefetch(href: string): void;
  /**
   * A browser history entry and where it sits now, where the router can read
   * it (the Navigation API): the entry showing, or with `key` the entry it
   * names. Undefined where the router cannot say, or the browser no longer
   * holds that entry: it drops its oldest past a cap, which shifts every index
   * down. With it `canGoBack` knows which way a Back or Forward went; without
   * it, it can only know that one happened.
   */
  historyEntry?(key?: string): { key: string; index: number } | undefined;
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

/**
 * The dynamic segments by name, merged across every active segment, slots
 * included: a slot a soft navigation kept keeps its params here too. Where a
 * slot can sit beside the page, read the address instead (`songRefFromPath`,
 * `listInView`).
 */
export function useParams<T extends Record<string, string>>(): Partial<T> {
  return useBackend().params as Partial<T>;
}

/**
 * Rewrites the search string from what it holds now. `replace` for state that
 * should not grow history, such as a query typed letter by letter.
 *
 * `edit` is handed the address as it is at the moment of writing, never the
 * one this component last rendered: two writes before a re-render — the
 * catalog's debounced query and a filter pressed in the same moment — would
 * otherwise both start from that render, and the second would put back what
 * the first changed.
 *
 * Not referentially stable, exactly as react-router's setter was not: an
 * effect that lists it re-runs after every write, so it needs a guard of its
 * own. A search-string write is not counted as a navigation (`useNavigationKey`,
 * and `canGoBack` where the backend cannot read the entry's index): it is the
 * screen's own state, kept in the address. Where it can, a pushed write is an
 * entry like any other, and Back over it stays in the app.
 */
export function useSetSearchParams(): (
  edit: (next: URLSearchParams) => void,
  options?: { replace?: boolean },
) => void {
  const { liveHref, writeSearch } = useBackend();
  return (edit, options = {}) => {
    const { pathname, searchParams: next } = new URL(liveHref(), ORIGIN);
    edit(next);
    writeSearch(withSearch(pathname, next.toString()), { replace: Boolean(options.replace) });
  };
}

export interface Router {
  push(href: string): void;
  replace(href: string): void;
  /**
   * Goes back, and never off the site: where nothing in the app is behind this
   * entry (an address opened in a fresh tab, or Back already taken to the
   * first screen), it replaces the entry with `fallback` instead.
   */
  back(fallback: string): void;
  /** Whether `back` would go back rather than replace with its fallback. */
  canGoBack(): boolean;
  /**
   * Loads `href` ahead of a navigation to it. On Next that is a server render
   * of a page nobody may open, so it is for the few places a reader is about
   * to go: a list's neighbors, and a song row the reader rests on or presses. See "The routing seam" in CLAUDE.md.
   */
  prefetch(href: string): void;
}

/** Stable for as long as the backend's functions are, which is for good. */
export function useRouter(): Router {
  const { push, replace, back, prefetch } = useBackend();
  const { noteNavigation, canGoBack } = useContext(HistoryContext);

  return useMemo(() => {
    const replaceWith = (href: string) => {
      noteNavigation(href, "replace");
      replace(href);
    };
    return {
      push(href) {
        // A push to the address showing replaces it, as a link to it does:
        // two identical entries in a row make Back appear to do nothing.
        if (noteNavigation(href, "push")) replace(href);
        else push(href);
      },
      replace: replaceWith,
      back(fallback) {
        if (canGoBack()) back();
        else replaceWith(fallback);
      },
      canGoBack,
      prefetch,
    };
  }, [push, replace, back, prefetch, noteNavigation, canGoBack]);
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
  /**
   * `false` for a screen few readers open, such as the editor: Next fetches
   * every visible link's page ahead of time, which on each song is a request
   * for nothing. Left out, the router decides, as it does for ordinary links.
   */
  prefetch?: false | undefined;
  /**
   * Called instead of navigating when a plain click leads to the address
   * already showing. Left out, such a click replaces the entry, as any link
   * to it does.
   */
  onShowing?: (() => void) | undefined;
};

/** A link inside the app. `href` is a path, with a search string if it needs one. */
export function Link({ href, replace, onClick, onShowing, ...rest }: LinkProps) {
  const { Link: BackendLink } = useBackend();
  const { noteNavigation } = useContext(HistoryContext);
  // Decided here rather than left to the router: a link to the address
  // showing replaces it, whatever the router would have done.
  const same = sameAddress(href, useCurrentHref());

  const onPress = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !isPlainClick(event)) return;
    if (same && onShowing) {
      event.preventDefault();
      onShowing();
      return;
    }
    noteNavigation(href, replace ? "replace" : "push");
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
 *
 * `active` decides for a screen whose path does not say which entry it belongs
 * to; left out, the path does (`pathMatches`).
 */
export function NavLink({
  href,
  className,
  active,
  ...rest
}: Omit<LinkProps, "className"> & {
  className: (state: { isActive: boolean }) => string;
  active?: boolean | undefined;
}) {
  const matched = pathMatches(usePathname(), href);
  const isActive = active ?? matched;
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
 *
 * Where the backend reads the entry's index, the trail is the entries between
 * the one this document loaded on and the one showing, so Back to the first
 * screen reads as nothing behind again. Elsewhere any Back or Forward counts as
 * a trail, and Back from the first screen would leave the site.
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
  const { historyEntry } = backend;
  const firstKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    hereRef.current = here;
  }, [here]);

  // The entry this document loaded on: read once, in the browser, and never
  // again, or a later read would move the start of the trail.
  useEffect(() => {
    firstKeyRef.current ??= historyEntry?.()?.key;
  }, [historyEntry]);

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
    const firstKey = firstKeyRef.current;
    const now = firstKey === undefined ? undefined : historyEntry?.();
    if (firstKey === undefined || !now) return movedRef.current;
    // Dropped only with every entry older than it, so each entry still held
    // is this document's own, and only the oldest has nothing behind it.
    return now.index > (historyEntry?.(firstKey)?.index ?? 0);
  }, [historyEntry]);

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
 * Hands a matched route's dynamic segments to what renders under it. For the
 * harness, which matches routes itself (`test/routes.tsx`); the app's backend
 * has them already. Unlike Next it answers for one page, never merging a slot's
 * params in, so a spec cannot show two segments' names colliding:
 * `routeParams.test.ts` keeps the reader's apart instead.
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

/** The entry a memory history is at. */
function showing({ entries, index }: MemoryHistory): URL {
  return entries[index] ?? new URL(ORIGIN);
}

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

  // The history as of the last move, ahead of the render it schedules: what
  // `liveHref` answers, as the browser's own location does on Next.
  const live = useRef(history);
  const move = useCallback((change: (current: MemoryHistory) => MemoryHistory) => {
    live.current = change(live.current);
    setHistory(live.current);
  }, []);

  const push = useCallback(
    (href: string) =>
      move(({ entries: urls, index }) => ({
        entries: [...urls.slice(0, index + 1), resolve(href, urls[index])],
        index: index + 1,
      })),
    [move],
  );
  const replace = useCallback(
    (href: string) =>
      move(({ entries: urls, index }) => ({
        entries: urls.map((url, at) => (at === index ? resolve(href, url) : url)),
        index,
      })),
    [move],
  );
  const back = useCallback(
    () =>
      move((current) => (current.index > 0 ? { ...current, index: current.index - 1 } : current)),
    [move],
  );
  const liveHref = useCallback(() => {
    const { pathname, search } = showing(live.current);
    return pathname + search;
  }, []);

  const { pathname, search } = showing(history);
  const backend = useMemo<NavigationBackend>(
    () => ({
      pathname,
      searchParams: new URLSearchParams(search),
      params: {},
      push,
      replace,
      back,
      liveHref,
      writeSearch: (href, options) => (options.replace ? replace(href) : push(href)),
      // Nothing to load: every screen is already in memory.
      prefetch: () => {},
      Link: MemoryLink,
    }),
    [pathname, search, push, replace, back, liveHref],
  );

  return (
    <NavigationProvider backend={backend} entriesBehind={entries.length > 1}>
      {children}
    </NavigationProvider>
  );
}

/** A plain anchor whose plain clicks move the memory history instead. */
function MemoryLink({ href, replace, prefetch: _prefetch, onClick, ...rest }: BackendLinkProps) {
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
