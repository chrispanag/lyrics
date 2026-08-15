import type { Credit, CreditRole } from "./types";

/**
 * Display order: who performed it matters most on a listing.
 *
 * One list, exported, because the song page groups credits by role in this same
 * order — two hand-maintained copies can silently disagree.
 */
export const CREDIT_DISPLAY_ORDER: CreditRole[] = [
  "artist",
  "performer",
  "composer",
  "lyricist",
];

const CREDIT_PRIORITY: Record<CreditRole, number> = Object.fromEntries(
  CREDIT_DISPLAY_ORDER.map((role, index) => [role, index]),
) as Record<CreditRole, number>;

/**
 * Formats the credits line shown under a song title.
 *
 * Names are de-duplicated because one person is very often both composer and
 * lyricist, and repeating their name reads as a mistake rather than as two
 * distinct credits.
 */
export function creditLine(credits: Credit[]): string {
  if (credits.length === 0) return "";

  const names = [...credits]
    .sort((a, b) => CREDIT_PRIORITY[a.role] - CREDIT_PRIORITY[b.role] || a.position - b.position)
    .map((credit) => credit.name);

  return [...new Set(names)].join(" · ");
}
