import { HttpResponse, delay, http } from "msw";
import { vi } from "vitest";

/**
 * Shortens every `AbortSignal.timeout` to 20ms, so a spec can watch
 * `guestRead`'s 3s budget run out without waiting for it. `client.test.ts`
 * pins the real budget; a route spec only needs to see that its read gives up.
 */
export function shortenReadBudget(): void {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(20));
}

/** A GET handler that never answers: an API that hangs rather than fails. */
export function hanging(url: string) {
  return http.get(url, async () => {
    await delay("infinite");
    return new HttpResponse(null, { status: 204 });
  });
}
