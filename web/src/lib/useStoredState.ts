import { type Dispatch, type SetStateAction, useLayoutEffect, useState } from "react";

/**
 * State seeded from something only the browser has (storage, mostly): starts as
 * `serverValue`, what a server render would produce, and takes `read()` in a
 * layout effect, before the browser paints. Read while rendering instead, the
 * server's markup and the browser's first render disagree. See CLAUDE.md, "The
 * Next.js shell".
 *
 * Read once on mount, not subscribed to; the setter is ordinary state for a
 * value the reader also writes.
 */
export function useStoredState<T>(serverValue: T, read: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(serverValue);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount; re-reading on a new `read` would undo what the reader has since written.
  useLayoutEffect(() => {
    // biome-ignore lint/nursery/useReactCompiler: read once before paint, for the reason above.
    setValue(read());
  }, []);
  return [value, setValue];
}
