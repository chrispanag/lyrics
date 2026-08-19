/*
 * A controllable IntersectionObserver, since jsdom has none.
 *
 * A no-op stub would be enough to keep the tap strips from throwing on mount,
 * but the one thing worth pinning about their hint is that it waits for the
 * strips to be on screen before spending the single showing it gets. A spec
 * therefore needs a way to say that they are, which is `intersectAll()`.
 *
 * Nothing here measures anything: jsdom has no layout, so an entry is only ever
 * "visible" because a test said so.
 */

type Callback = (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void;

const live = new Set<StubIntersectionObserver>();

class StubIntersectionObserver implements IntersectionObserver {
  // The three the interface demands and nothing reads. A margin held here would
  // be a number a spec could believe was being applied to something.
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds: readonly number[] = [0];

  private readonly targets = new Set<Element>();

  constructor(private readonly callback: Callback) {
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

/**
 * Tells everything currently being observed that it has come into view.
 *
 * Everything, since one component observes: the day a second one does, this
 * takes the element to report on. Unmounting is what empties the set — the
 * hook's effect cleanup disconnects, and RTL's `cleanup()` runs first in the
 * shared teardown — so nothing has to be reset between specs.
 */
export function intersectAll(): void {
  for (const observer of [...live]) observer.report();
}
