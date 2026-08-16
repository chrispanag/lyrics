import { PrldSessionClient } from "@prelude.so/js-sdk/session";

import { setTokenProvider } from "@/api/client";

const APP_ID = import.meta.env.VITE_PRELUDE_APP_ID ?? "";
// Optional. The SDK key is a publishable client identifier, not a secret — it
// is safe in the bundle, unlike the Management API key, which must stay
// server-side.
const SDK_KEY = import.meta.env.VITE_PRELUDE_SDK_KEY ?? "";

/**
 * The Prelude session client.
 *
 * A module singleton rather than component state: it owns session storage and
 * token refresh, so a second instance would keep its own cache and the two
 * would disagree about who is signed in.
 */
export const sessionClient = new PrldSessionClient({
  domain: `${APP_ID}.session.prelude.dev`,
  ...(SDK_KEY ? { sdkKey: SDK_KEY } : {}),
});

/**
 * Returns the current access token, or null when signed out.
 *
 * `refresh()` is served from the SDK's cache while the token is still valid, so
 * calling it per request is cheap — and on the first call it is also what
 * restores a stored session. That is why a request issued before `AuthProvider`
 * has finished mounting still carries a token: it awaits the same restore the
 * provider is waiting on. Tokens are never copied into application state or
 * storage; the SDK is the single owner.
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

// Registered at import time, and deliberately not from an effect in
// AuthProvider. React flushes child effects before parent ones, so a query
// mounted underneath the provider begins fetching *before* the provider's own
// effects run — and every such request went out with the module default, which
// returns no token, and was answered as a guest. `GET /lists/{id}` was the
// visible case: a private list 404ing to its own owner on every page load, with
// no 401 for the client to retry. Module scope has no ordering left to lose.
setTokenProvider(getAccessToken);
