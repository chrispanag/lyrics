import type { PrldSessionClient } from "@prelude.so/js-sdk/session";

import { setTokenProvider } from "@/api/client";
import { hasStoredUser } from "./storedUser";

const APP_ID = process.env.NEXT_PUBLIC_PRELUDE_APP_ID ?? "";
// Optional, and publishable: safe in the bundle (unlike the Management API key).
const SDK_KEY = process.env.NEXT_PUBLIC_PRELUDE_SDK_KEY ?? "";

// Must name the same host as the API's PRELUDE_SESSION_DOMAIN: the issuer is
// per-host, so two different hosts reject every token. The custom domain keeps
// session cookies first-party.
const SESSION_DOMAIN =
  (process.env.NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN ?? "").trim() || `${APP_ID}.session.prelude.dev`;

/**
 * The email OTP login configuration password reset sends its code through. Not
 * the app's default login, so a code is never offered as a way to sign in. See
 * CLAUDE.md, "Password reset".
 */
export const OTP_LOGIN_CONFIG_ID = (
  process.env.NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID ?? ""
).trim();

/**
 * Present while this browser may hold a session. The SDK cannot tell: its
 * refresh token is a cookie on the session domain, so `refresh()` always asks,
 * and a guest's 401 lands in the console on every page. Without the hint a
 * guest is answered here. No token is kept in it.
 */
const SESSION_HINT = "lyrics:session";

/**
 * The hint this tab could not store. Storage that reads but refuses writes (a
 * full quota) would otherwise answer the session just opened as a guest's.
 */
let unstoredSession = false;

/** Records that a session was opened, or that there is none behind the hint. */
export function markSession(open: boolean): void {
  unstoredSession = false;
  try {
    if (open) localStorage.setItem(SESSION_HINT, "");
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    unstoredSession = open;
  }
}

function mayHaveSession(): boolean {
  if (unstoredSession) return true;
  try {
    return localStorage.getItem(SESSION_HINT) !== null;
  } catch {
    // Blocked storage: ask the SDK, as before the hint existed.
    return true;
  }
}

// Sessions opened before the hint existed left only the profile snapshot.
// Read at import, before `AuthProvider`'s first commit erases it. Presence,
// not a valid profile: an older release's shape still means a session.
if (typeof window !== "undefined" && hasStoredUser()) markSession(true);

let client: Promise<PrldSessionClient> | undefined;

const loadSdk = () => import("@prelude.so/js-sdk/session");

// Started at import, not at the first query, so the download overlaps
// hydration. Only the module: the client is still built on first use.
if (typeof window !== "undefined") {
  loadSdk().catch(() => {});
}

/**
 * The Prelude session client, built on first use. A singleton: a second
 * instance would disagree about the session. Lazy so this module imports on a
 * server, where it refuses by name rather than leaving the SDK to fail at
 * some later call.
 *
 * The SDK is a dynamic import: it inlines its WASM core as base64, about
 * 330 kB that would otherwise sit in the first chunk of every page. Every
 * page still prefetches it beside hydration rather than ahead of it: a
 * returning reader's first query asks for a token, and a guest's sign-in needs
 * it. A failed chunk load or construction is not kept, so the next call tries
 * again.
 */
export function sessionClient(): Promise<PrldSessionClient> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("The Prelude session client is browser-only; a server render is a guest."),
    );
  }
  // The catch follows the construction too: a constructor that throws must not
  // leave a rejected promise behind for every later call.
  client ??= loadSdk()
    .then(
      ({ PrldSessionClient }) =>
        new PrldSessionClient({
          domain: SESSION_DOMAIN,
          ...(SDK_KEY ? { sdkKey: SDK_KEY } : {}),
        }),
    )
    .catch((error: unknown) => {
      client = undefined;
      throw error;
    });
  return client;
}

/**
 * Returns the current access token, or null when signed out. `refresh()` is
 * cached while valid and restores a stored session on first call. Tokens are
 * never copied out of the SDK.
 */
export async function getAccessToken(forceRefresh?: boolean): Promise<string | null> {
  // A server render is a guest.
  if (typeof window === "undefined") return null;
  // A guest, answered without loading the SDK or asking the session domain.
  if (!mayHaveSession()) return null;

  // Outside the try: an SDK that failed to load says nothing about the
  // session. Read as signed out, it would turn a signed-in visitor into a guest
  // and erase their snapshot. Thrown, the request fails and its retry loads
  // the SDK again.
  const sdk = await sessionClient();
  try {
    if (forceRefresh) {
      await sdk.invalidateCache();
    }
    const { user: session } = await sdk.refresh();
    return session?.accessToken ?? null;
  } catch (error) {
    // No session, or the refresh token has been revoked. Only the session
    // domain's 401 says so: a network failure keeps the hint for the next try.
    if (error instanceof Error && error.name === "UnauthorizedError") markSession(false);
    return null;
  }
}

// At import time, never from an effect: child queries fetch before the
// provider's effects run, and would go out as a guest (a private list 404s to
// its owner, with no 401 to retry). Registered on a server too, where it
// answers null without touching the SDK.
setTokenProvider(getAccessToken);
