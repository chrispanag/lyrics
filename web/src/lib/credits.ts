import type { Credit, CreditRole, RecordingPerformer, Song } from "./types";

/**
 * Display order for the authorship credits, shared by the song page's grouping
 * and `songByline`. Performers belong to a recording and render ahead of these.
 */
export const CREDIT_DISPLAY_ORDER: CreditRole[] = ["composer", "lyricist"];

const CREDIT_PRIORITY: Record<CreditRole, number> = Object.fromEntries(
  CREDIT_DISPLAY_ORDER.map((role, index) => [role, index]),
) as Record<CreditRole, number>;

/**
 * The two label maps deliberately differ: a listing says what was contributed
 * ("Music"), a picker names the role being chosen ("Composer"). Do not align them.
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
 * Who a song is performed by: the first recording's performers. The server
 * already orders recordings and their performers, so `recordings[0]` is the
 * first recording and nothing here re-sorts it.
 */
export function songPerformers(song: Pick<Song, "recordings">): RecordingPerformer[] {
  return song.recordings[0]?.performers ?? [];
}

/**
 * The one line of names under a song title, on a card and in quick search.
 *
 * The performers lead, then the authorship credits, with each name once.
 */
export function songByline(song: Pick<Song, "credits" | "recordings">): string {
  const performers = songPerformers(song).map((performer) => performer.name);

  const credited = [...song.credits]
    .sort((a, b) => CREDIT_PRIORITY[a.role] - CREDIT_PRIORITY[b.role] || a.position - b.position)
    .map((credit) => credit.name);

  return [...new Set([...performers, ...credited])].join(" · ");
}

/**
 * Groups a song's authorship credits in CREDIT_DISPLAY_ORDER, dropping empty
 * roles so no label renders above an empty value.
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
