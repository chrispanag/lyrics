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

  /** What it has been given, for the spec that asks which element that is. */
  observed(): Element[] {
    return [...this.targets];
  }

  /** Reports every observed element as visible, the way scrolling to it would. */
  report(): void {
    const entries = [...this.targets].map(
      // Only the two fields the app reads.
      (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
    );
    if (entries.length > 0) this.callback(entries, this);
  }
}

export { StubIntersectionObserver };

/**
 * Tells everything currently being observed that it has come into view.
 * Unmounting disconnects, so nothing needs resetting between specs.
 */
export function intersectAll(): void {
  for (const observer of [...live]) observer.report();
}

/**
 * Everything currently being watched, whichever observer is watching it. Lets a
 * spec check `md:hidden` sits on the observed box itself (jsdom applies no CSS).
 */
export function observedElements(): Element[] {
  return [...live].flatMap((observer) => observer.observed());
}
