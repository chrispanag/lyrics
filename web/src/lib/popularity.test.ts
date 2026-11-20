import { afterEach, describe, expect, it } from "vitest";

import { popularitySummary, visitorId } from "./popularity";
import type { SongPopularity } from "@/lib/types";

const tally = (overrides: Partial<SongPopularity> = {}): SongPopularity => ({
  anonymous_clicks: 0,
  authenticated_clicks: 0,
  list_adds: 0,
  list_users: 0,
  score: 0,
  ...overrides,
});

describe("visitorId", () => {
  afterEach(() => localStorage.clear());

  it("keeps one id for this browser", () => {
    const first = visitorId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(visitorId()).toBe(first);
  });

  it("replaces a stored nil id, which the API refuses", () => {
    localStorage.setItem("songfolio.visitor", "00000000-0000-0000-0000-000000000000");
    expect(visitorId()).not.toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("popularitySummary", () => {
  it("says nothing until a song has been opened or saved", () => {
    expect(popularitySummary(undefined)).toBeNull();
    expect(popularitySummary(tally())).toBeNull();
  });

  it("keeps anonymous and signed-in clicks apart", () => {
    expect(popularitySummary(tally({ anonymous_clicks: 1 }))).toBe("1 anonymous click");
    expect(popularitySummary(tally({ anonymous_clicks: 4 }))).toBe("4 anonymous clicks");
    expect(popularitySummary(tally({ authenticated_clicks: 1 }))).toBe("1 signed-in click");
    expect(popularitySummary(tally({ anonymous_clicks: 3, authenticated_clicks: 1 }))).toBe(
      "4 clicks — 3 anonymous, 1 signed in",
    );
  });

  it("names the people who have it saved, and the times when those differ", () => {
    expect(popularitySummary(tally({ list_adds: 1, list_users: 1 }))).toBe("Saved by 1 person");
    expect(popularitySummary(tally({ list_adds: 2, list_users: 2 }))).toBe("Saved by 2 people");
    expect(popularitySummary(tally({ list_adds: 4, list_users: 2 }))).toBe(
      "Saved 4 times by 2 people",
    );
    expect(popularitySummary(tally({ list_adds: 3, list_users: 0 }))).toBe("Saved 3 times");
  });

  it("joins the two", () => {
    expect(
      popularitySummary(
        tally({ anonymous_clicks: 3, authenticated_clicks: 1, list_adds: 4, list_users: 2 }),
      ),
    ).toBe("4 clicks — 3 anonymous, 1 signed in · Saved 4 times by 2 people");
  });
});
