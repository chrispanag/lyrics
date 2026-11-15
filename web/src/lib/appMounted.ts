import { useSyncExternalStore } from "react";

/*
 * Whether the client-only app has mounted, for what a server renders in its
 * place until then. See "What the server says while the app is still
 * client-only" in CLAUDE.md.
 *
 * Only ever goes from false to true: the app does not unmount.
 */

let mounted = false;
const listeners = new Set<() => void>();

/** Called by `AppRoot` once its tree is in the DOM. Idempotent. */
export function markAppMounted(): void {
  if (mounted) return;
  mounted = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** False on a server and through hydration, true once the app has mounted. */
export function useAppMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mounted,
    () => false,
  );
}
