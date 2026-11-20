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
 * Spoken form of the card badge: how many times the song has been placed in a
 * list. Zero is not a badge, so this is only called for a positive count.
 */
export function listAddsLabel(adds: number): string {
  return adds === 1 ? "Saved once" : `Saved ${adds} times`;
}
