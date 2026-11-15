import type { PrldSessionClient } from "@prelude.so/js-sdk/session";

import { setTokenProvider } from "@/api/client";

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
 * page still downloads it, since the first query asks for a token, but beside
 * hydration rather than ahead of it. A failed chunk load is not kept, so the
 * next call tries again.
 */
export function sessionClient(): Promise<PrldSessionClient> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("The Prelude session client is browser-only; a server render is a guest."),
    );
  }
  client ??= loadSdk().then(
    ({ PrldSessionClient }) =>
      new PrldSessionClient({
        domain: SESSION_DOMAIN,
        ...(SDK_KEY ? { sdkKey: SDK_KEY } : {}),
      }),
    (error: unknown) => {
      client = undefined;
      throw error;
    },
  );
  return client;
}

/**
 * Returns the current access token, or null when signed out. `refresh()` is
 * cached while valid and restores a stored session on first call. Tokens are
 * never copied out of the SDK.
 */
export async function getAccessToken(forceRefresh?: boolean): Promise<string | null> {
  try {
    const sdk = await sessionClient();
    if (forceRefresh) {
      await sdk.invalidateCache();
    }
    const { user: session } = await sdk.refresh();
    return session?.accessToken ?? null;
  } catch {
    // No session, the refresh token has been revoked, or this is a server,
    // where `sessionClient` refuses: a server render is a guest.
    return null;
  }
}

// At import time, never from an effect: child queries fetch before the
// provider's effects run, and would go out as a guest (a private list 404s to
// its owner, with no 401 to retry). Registered on a server too, where it
// answers null without touching the SDK.
setTokenProvider(getAccessToken);
