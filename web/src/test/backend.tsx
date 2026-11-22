import { vi } from "vitest";

import type { NavigationBackend } from "@/lib/navigation";

/**
 * A router that records what it is asked to load ahead. The test router's
 * `prefetch` does nothing, so a backend like this is what can see it. Mount it
 * with `NavigationProvider`; every other method does nothing.
 */
export function recordingBackend({ pathname = "/", search = "" } = {}) {
  return {
    pathname,
    searchParams: new URLSearchParams(search),
    params: {},
    push: () => {},
    replace: () => {},
    back: () => {},
    liveHref: () => (search ? `${pathname}?${search}` : pathname),
    writeSearch: () => {},
    prefetch: vi.fn<(href: string) => void>(),
    Link: ({ href, replace: _replace, prefetch: _prefetch, ...rest }) => (
      <a href={href} {...rest} />
    ),
  } satisfies NavigationBackend;
}
