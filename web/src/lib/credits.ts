import type { Credit, CreditRole, Song } from "./types";

/**
 * Display order for the authorship credits.
 *
 * One list, exported, because the song page groups credits by role in this same
 * order — two hand-maintained copies can silently disagree. Performers are not
 * in it: they belong to a recording and are rendered ahead of these, which
 * `songByline` below is the other half of.
 */
export const CREDIT_DISPLAY_ORDER: CreditRole[] = ["composer", "lyricist"];

const CREDIT_PRIORITY: Record<CreditRole, number> = Object.fromEntries(
  CREDIT_DISPLAY_ORDER.map((role, index) => [role, index]),
) as Record<CreditRole, number>;

/**
 * The two label maps, side by side because they deliberately differ and that
 * has never been written down anywhere.
 *
 * A listing says what the person contributed — "Music", under a heading a
 * reader scans — while a picker names the role being chosen, "Composer". Read
 * as a mistake, one of them gets "fixed" to match the other; kept in two route
 * files, they drift without anyone noticing.
 */
export const CREDIT_DISPLAY_LABELS: Record<CreditRole, string> = {
  composer: "Music",
  lyricist: "Lyrics",
};

export const CREDIT_PICKER_LABELS: Record<CreditRole, string> = {
  composer: "Composer",
  lyricist: "Lyricist",
};

/**
 * The one line of names under a song title, on a card and in quick search.
 *
 * The first recording's performers lead, then the authorship credits — which is
 * the order this line has always had, when performing was a credit role sorted
 * to the front. Names are de-duplicated because one person is very often both
 * composer and lyricist, and very often also the performer of what they wrote;
 * repeating a name reads as a mistake rather than as two distinct credits.
 *
 * `recordings[0]` is the first recording because the server ordered them, and a
 * song with none contributes no performers rather than falling back to anything.
 */
export function songByline(song: Pick<Song, "credits" | "recordings">): string {
  const performers = [...(song.recordings[0]?.performers ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((performer) => performer.name);

  const credited = [...song.credits]
    .sort((a, b) => CREDIT_PRIORITY[a.role] - CREDIT_PRIORITY[b.role] || a.position - b.position)
    .map((credit) => credit.name);

  return [...new Set([...performers, ...credited])].join(" · ");
}

/**
 * Groups a song's authorship credits for display, in CREDIT_DISPLAY_ORDER, and
 * drops the roles nobody is credited in.
 *
 * Dropping them is what keeps a label from rendering above an empty value — the
 * same reason the performers row on the song page is conditional.
 */
export function groupCredits(credits: Credit[]): [CreditRole, Credit[]][] {
  return CREDIT_DISPLAY_ORDER.map(
    (role) =>
      [
        role,
        credits.filter((credit) => credit.role === role).sort((a, b) => a.position - b.position),
      ] as [CreditRole, Credit[]],
  ).filter(([, matching]) => matching.length > 0);
}
