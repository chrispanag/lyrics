/*
 * A controllable IntersectionObserver, since jsdom has none. An entry is only
 * "visible" when a spec calls `intersectAll()`.
 */

type Callback = (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void;

const live = new Set<StubIntersectionObserver>();

class StubIntersectionObserver implements IntersectionObserver {
  // Required by the interface; nothing reads them.
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds: readonly number[] = [0];

  private readonly targets = new Set<Element>();
  private readonly callback: Callback;

  constructor(callback: Callback) {
    this.callback = callback;
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

  /** Reports every observed element as showing `ratio` of itself. */
  report(ratio: number): void {
    const entries = [...this.targets].map(
      // Only the fields the app reads.
      (target) =>
        ({
          target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        }) as IntersectionObserverEntry,
    );
    if (entries.length > 0) this.callback(entries, this);
  }
}

export { StubIntersectionObserver };

/**
 * Tells everything currently being observed that it has come into view, or
 * with `0`, that it has left it. Unmounting disconnects, so nothing needs
 * resetting between specs.
 */
export function intersectAll(ratio = 1): void {
  for (const observer of [...live]) observer.report(ratio);
}
