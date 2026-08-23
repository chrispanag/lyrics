import { apiUrl, toQuery } from "@/api/client";
import type { User } from "@/lib/types";

/**
 * What a picture is built from. Narrower than `User` so an admin row, the
 * signed-in account and a stubbed fixture can all be passed in.
 */
export type Identity = Pick<User, "id" | "email" | "display_name" | "avatar_updated_at">;

/**
 * The URL of a user's picture, or null when they have none.
 *
 * Keyed on `avatar_updated_at` and never on whether an image loaded: the
 * fallback is decided from data already in hand, the same way a song's video
 * badge reads `youtube_video_id`. The version in the query string is what makes
 * a replacement visible immediately, and it has to: the path itself never
 * changes. A removal has no version to move to, so it is only ever as quick as
 * the response's freshness window — five minutes, which is why that response is
 * not served `immutable`.
 */
export function avatarSrc(user: Identity): string | null {
  if (!user.avatar_updated_at) return null;

  return apiUrl(`/api/v1/users/${user.id}/avatar${toQuery({ v: user.avatar_updated_at })}`);
}

/** Up to two initials for a user with no picture. */
export function initials(user: Pick<User, "email" | "display_name">): string {
  const name = user.display_name?.trim() ?? "";
  if (name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      // Split into code points rather than sliced, so a name starting with an
      // emoji or an astral character does not begin with half of one.
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toLocaleUpperCase();
  }
  return (Array.from(user.email)[0] ?? "?").toLocaleUpperCase();
}

/**
 * Class names for the circle behind those initials.
 *
 * Written out in full because Tailwind reads these files as text: a class
 * assembled from pieces at runtime is not in the stylesheet.
 */
const PALETTE = [
  "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100",
  "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100",
  "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100",
  "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-100",
  "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-100",
] as const;

/**
 * A stable color for a user, derived from their id.
 *
 * From the id rather than the name, so renaming yourself does not change the
 * face other people have learned to recognize in a list.
 */
export function avatarPalette(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003;
  }
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0];
}
