import { type PointerEvent, useCallback, useEffect, useRef } from "react";

/** Long enough that sweeping the pointer across a list starts nothing. */
const HOVER_DELAY_MS = 75;

/**
 * Handlers that start `prefetch` when the reader shows intent: a mouse resting
 * on the element for a moment, or a press (touch has no hover, and its press
 * lands before the click does). Leaving first cancels the wait.
 *
 * `prefetch` should be cheap and deduplicated (a query prefetch, a router
 * prefetch); the handlers keep
 * their identity while it does, so a memoized element is not re-rendered by
 * them. Only a mouse hovers: a touch's synthesized enter would start the
 * request a press already starts.
 */
export function useIntentPrefetch(prefetch: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  // A card can unmount with its wait pending, as a filter replaces the list.
  useEffect(() => cancel, [cancel]);

  const onPointerEnter = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      cancel();
      timer.current = setTimeout(prefetch, HOVER_DELAY_MS);
    },
    [cancel, prefetch],
  );

  const onPointerDown = useCallback(() => {
    cancel();
    prefetch();
  }, [cancel, prefetch]);

  return { onPointerEnter, onPointerLeave: cancel, onPointerDown };
}
