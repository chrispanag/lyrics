import { ROLES, type User } from "@/lib/types";

/**
 * The profile this browser last held a session for.
 *
 * Restoring a session is two round trips — the SDK's token refresh, then
 * `GET /me` — and until they land the app knows nothing about who is here.
 * Rendering that as "nobody" is what made every refresh of a signed-in page
 * paint the *guest* answer first: a navigation offering a sign-in button and
 * no Lists in it, a catalog with no Add song, all of it replaced a few
 * hundred milliseconds later. This is the same trade `applyTheme(storedTheme())`
 * makes in `main.tsx`: paint the last known answer rather than a wrong one while
 * waiting for the right one.
 *
 * It is a hint about what to *draw* and nothing more. No token is kept here —
 * the SDK owns those, as `auth/session` says — so the snapshot is no way into an
 * account, and a stale one costs at most one paint of chrome the server would
 * refuse to act on anyway (`hasRole` decides what to render, never what is
 * permitted). What it must never do is decide *where a visitor goes*: the
 * redirects read `loading` first, so a guess cannot move anybody.
 */
const KEY = "lyrics:last-user";

/** The profile to paint until the real one arrives, if there is one. */
export function storedUser(): User | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return asUser(JSON.parse(raw));
  } catch {
    // Malformed JSON, or a browser refusing to hand its storage over. Either
    // way there is nothing to paint early, which is where this started.
    return null;
  }
}

/** Records the profile, or forgets it once there is no session behind it. */
export function storeUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  } catch {
    // A browser that will not store it only loses the early paint.
  }
}

/**
 * The value as a profile, or null if it is not one.
 *
 * Checked rather than cast, because the shape is whatever an earlier release
 * left in this browser — and four fields rather than all of `User`, because a
 * field that is merely absent reads as null and draws as nothing, which is what
 * a missing picture or display name look like anyway. Refusing a snapshot over
 * one of those would spend the flash this module exists to prevent.
 *
 * These four are the ones absence does not draw as nothing. `id`, `email` and
 * `role` are drawn — an empty name, no role, an avatar address with no account
 * in it. `email_verified_at` is drawn nowhere, but absent reads as *unverified*,
 * leaving the gate's wait on `loading` as the only other thing between that and
 * a verified visitor sitting at a code form. Two guards, this one costing a line.
 */
function asUser(value: unknown): User | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<User>;
  const verified = candidate.email_verified_at;

  return typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    ROLES.some((role) => role === candidate.role) &&
    (verified === null || typeof verified === "string")
    ? (candidate as User)
    : null;
}
