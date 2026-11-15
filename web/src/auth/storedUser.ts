import { ROLES, type User } from "@/lib/types";

/**
 * The profile this browser last held a session for, painted while the restore
 * runs so a refresh does not flash guest chrome. It decides what to draw, never
 * where anyone goes: redirects read `loading` first. No token is kept here.
 */
const KEY = "lyrics:last-user";

/** The profile to paint until the real one arrives, if there is one. */
export function storedUser(): User | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return asUser(JSON.parse(raw));
  } catch {
    // Malformed JSON or blocked storage: nothing to paint early.
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
 * The value as a profile, or null if it is not one. Checked, not cast: an older
 * release may have stored another shape. Only fields whose absence would
 * mislead are required; a missing `email_verified_at` would read as unverified.
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
