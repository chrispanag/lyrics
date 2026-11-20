import { pluralize } from "@/lib/format";
import type { SongPopularity } from "@/lib/types";

const VISITOR_KEY = "songfolio.visitor";

/** uuid.Parse's shape, both cases. A nil id is refused: it would merge every broken client into one actor. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id this browser sends with an anonymous click, so a refresh is not a
 * second opening. Read from storage when called — from an effect, not during
 * render. A browser that refuses storage gets a fresh id for this call.
 */
export function visitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing && UUID_RE.test(existing) && !isNilUuid(existing)) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function isNilUuid(value: string): boolean {
  return value.replace(/-/g, "") === "0".repeat(32);
}

/**
 * One line for the song page, or null when nothing has been recorded. Clicks
 * stay split between anonymous and signed-in; saves name the people who have
 * it now and, when that is fewer than the placements, how many times it was saved.
 */
export function popularitySummary(popularity: SongPopularity | undefined): string | null {
  if (!popularity) return null;

  const parts: string[] = [];
  const clicks = clickSummary(popularity.anonymous_clicks, popularity.authenticated_clicks);
  if (clicks) parts.push(clicks);
  const saves = saveSummary(popularity.list_adds, popularity.list_users);
  if (saves) parts.push(saves);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function clickSummary(anonymous: number, signedIn: number): string | null {
  if (anonymous === 0 && signedIn === 0) return null;
  if (signedIn === 0) return pluralize(anonymous, "anonymous click");
  if (anonymous === 0) return pluralize(signedIn, "signed-in click");
  return `${pluralize(anonymous + signedIn, "click")} — ${anonymous} anonymous, ${signedIn} signed in`;
}

function saveSummary(adds: number, people: number): string | null {
  if (adds === 0 && people === 0) return null;
  if (people === 0) return adds === 1 ? "Saved once" : `Saved ${adds} times`;

  const who = people === 1 ? "1 person" : `${people} people`;
  // One placement per person needs no separate "times".
  if (adds <= people) return `Saved by ${who}`;
  const times = adds === 1 ? "once" : `${adds} times`;
  return `Saved ${times} by ${who}`;
}
