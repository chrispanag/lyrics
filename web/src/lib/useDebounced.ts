import { useEffect, useState } from "react";

/**
 * Returns a value that only updates after it has been stable for `delay` ms.
 *
 * Search runs on every keystroke otherwise, and each query costs a full-text
 * scan plus snippet generation — work that is thrown away as soon as the next
 * character arrives.
 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
