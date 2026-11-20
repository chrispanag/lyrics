/**
 * Proactive content negotiation for the two representations this site serves,
 * per RFC 9110 §12.4–12.5 and the Accept: text/markdown profile
 * (https://acceptmarkdown.com/). A more specific range overrides a wildcard
 * regardless of q, and q=0 rejects that range.
 */

export const HTML = "text/html";
export const MARKDOWN = "text/markdown";

const PRODUCES = [HTML, MARKDOWN] as const;

export type Produced = (typeof PRODUCES)[number];

interface AcceptEntry {
  type: string;
  q: number;
  specificity: number;
}

/** Parse one Accept header into ranges, keeping the client's order. */
function parseAccept(header: string): AcceptEntry[] {
  const entries: AcceptEntry[] = [];
  for (const raw of header.split(",")) {
    const parts = raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    const type = parts[0]?.toLowerCase();
    if (!type) continue;

    let q = 1;
    for (const param of parts.slice(1)) {
      const eq = param.indexOf("=");
      if (eq === -1) continue;
      const name = param.slice(0, eq).trim().toLowerCase();
      const value = param.slice(eq + 1).trim();
      if (name !== "q") continue;
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) q = Math.max(0, Math.min(1, parsed));
    }

    const specificity = type === "*/*" ? 0 : type.endsWith("/*") ? 1 : 2;
    entries.push({ type, q, specificity });
  }
  return entries;
}

function matches(entry: AcceptEntry, candidate: string): boolean {
  if (entry.type === "*/*") return true;
  if (entry.type.endsWith("/*")) return candidate.startsWith(entry.type.slice(0, -1));
  return entry.type === candidate;
}

/**
 * The representation to send, or null when the client named types and rejected
 * every one this site can produce. A missing header prefers HTML, which is
 * what a browser sends when it sends nothing.
 */
export function preferredType(header: string | null): Produced | null {
  if (!header?.trim()) return HTML;

  const entries = parseAccept(header);
  if (entries.length === 0) return HTML;

  let best: Produced | null = null;
  let bestQ = -1;
  let bestPosition = Number.POSITIVE_INFINITY;

  for (const candidate of PRODUCES) {
    let matched: AcceptEntry | null = null;
    let matchedPosition = Number.POSITIVE_INFINITY;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!entry || !matches(entry, candidate)) continue;
      if (
        matched === null ||
        entry.specificity > matched.specificity ||
        (entry.specificity === matched.specificity && index < matchedPosition)
      ) {
        matched = entry;
        matchedPosition = index;
      }
    }
    if (!matched || matched.q <= 0) continue;
    if (matched.q > bestQ || (matched.q === bestQ && matchedPosition < bestPosition)) {
      bestQ = matched.q;
      bestPosition = matchedPosition;
      best = candidate;
    }
  }

  return best;
}
