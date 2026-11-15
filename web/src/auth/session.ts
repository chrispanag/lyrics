import { PrldSessionClient } from "@prelude.so/js-sdk/session";

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

/** The Prelude session client. A singleton: a second instance would disagree about the session. */
export const sessionClient = new PrldSessionClient({
  domain: SESSION_DOMAIN,
  ...(SDK_KEY ? { sdkKey: SDK_KEY } : {}),
});

/**
 * Returns the current access token, or null when signed out. `refresh()` is
 * cached while valid and restores a stored session on first call. Tokens are
 * never copied out of the SDK.
 */
export async function getAccessToken(forceRefresh?: boolean): Promise<string | null> {
  try {
    if (forceRefresh) {
      await sessionClient.invalidateCache();
    }
    const { user: session } = await sessionClient.refresh();
    return session?.accessToken ?? null;
  } catch {
    // No session, or the refresh token has been revoked.
    return null;
  }
}

// At import time, never from an effect: child queries fetch before the
// provider's effects run, and would go out as a guest (a private list 404s to
// its owner, with no 401 to retry).
setTokenProvider(getAccessToken);
