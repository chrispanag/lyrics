import { type PointerEvent, useCallback, useEffect, useRef } from "react";

/** Long enough that sweeping the pointer across a list starts nothing. */
const HOVER_DELAY_MS = 75;

/**
 * Handlers that start `prefetch` when the reader shows intent: a mouse resting
 * on the element for a moment, a mouse press, or a touch held as long without
 * turning into a scroll (touch has no hover). Leaving first cancels the wait,
 * and so does the `pointercancel` a touch sends once the browser takes it for a
 * scroll, so a finger flicking down a list loads nothing.
 *
 * `prefetch` should be cheap and deduplicated, as a query prefetch and a router
 * prefetch are; the handlers keep their identity while it does, so a memoized
 * element is not re-rendered by them. Only a mouse hovers: a touch's
 * synthesized enter would start the wait a press already starts.
 */
export function useIntentPrefetch(prefetch: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback(() => clearTimeout(timer.current), []);

  // A card can unmount with its wait pending, as a filter replaces the list.
  useEffect(() => cancel, [cancel]);

  const wait = useCallback(() => {
    cancel();
    timer.current = setTimeout(prefetch, HOVER_DELAY_MS);
  }, [cancel, prefetch]);

  const onPointerEnter = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType === "mouse") wait();
    },
    [wait],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return wait();
      cancel();
      prefetch();
    },
    [cancel, wait, prefetch],
  );

  return { onPointerEnter, onPointerLeave: cancel, onPointerCancel: cancel, onPointerDown };
}
