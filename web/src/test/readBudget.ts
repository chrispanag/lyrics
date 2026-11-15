import { HttpResponse, delay, http } from "msw";
import { vi } from "vitest";

import { READ_BUDGET_MS } from "@/api/client";

/**
 * Shortens `guestRead`'s 3s budget to 20ms, so a spec can watch it run out
 * without waiting for it; `client.test.ts` pins the real budget. Any other
 * clock is left alone, so a route reading on a budget of its own hangs and
 * fails its spec instead of passing on a borrowed one.
 */
export function shortenReadBudget(): void {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
    realTimeout(ms === READ_BUDGET_MS ? 20 : ms),
  );
}

/** A GET handler that never answers: an API that hangs rather than fails. */
export function hanging(url: string) {
  return http.get(url, async () => {
    await delay("infinite");
    return new HttpResponse(null, { status: 204 });
  });
}
