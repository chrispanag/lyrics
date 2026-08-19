/*
 * A controllable IntersectionObserver, since jsdom has none.
 *
 * A no-op stub would be enough to keep the tap strips from throwing on mount,
 * but the one thing worth pinning about their hint is that it waits for the
 * strips to be on screen before spending the single showing it gets. A spec
 * therefore needs a way to say that they are, which is `scrollIntoView()`.
 *
 * Nothing here measures anything: jsdom has no layout, so an entry is only ever
 * "visible" because a test said so.
 */

type Callback = (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void;

const live = new Set<StubIntersectionObserver>();

class StubIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[] = [0];

  private readonly targets = new Set<Element>();

  constructor(
    private readonly callback: Callback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? "0px";
    live.add(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
    live.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Reports every observed element as visible, the way scrolling to it would. */
  report(): void {
    const entries = [...this.targets].map(
      // Only the two fields the app reads. Filling in a whole entry — bounds,
      // ratios, a timestamp — would be inventing geometry that no test can act
      // on, in an environment that has none.
      (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
    );
    if (entries.length > 0) this.callback(entries, this);
  }
}

export { StubIntersectionObserver };

/** Tells everything currently being observed that it has come into view. */
export function scrollIntoView(): void {
  for (const observer of [...live]) observer.report();
}

/** Drops observers left behind by an unmounted tree. */
export function resetObservers(): void {
  live.clear();
}
