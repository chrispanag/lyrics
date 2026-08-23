import type { ApiErrorBody } from "@/lib/types";

// A production build defaults to the page's own origin, because that is how the
// app is deployed: one domain, with `/api` routed to the API and everything
// else to these assets. Baking an absolute URL in would survive until the
// domain changed and then serve a bundle pointing at the old one.
//
// Development is the case that needs an override — the dev server serves :5173
// and the API listens on :8080 — so the fallback is only reached there. An
// explicit NEXT_PUBLIC_API_BASE_URL still wins in either mode, including when
// set to "", which is what `make mobile` relies on: emptied, every call goes to
// this origin and through the rewrite in next.config.ts.
//
// The guard is `!== "production"` rather than `=== "development"` because
// vitest runs as "test", and its specs expect the same :8080 fallback they got
// from Vite's `import.meta.env.DEV`.
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (process.env.NODE_ENV !== "production" ? "http://localhost:8080" : "");

/**
 * The absolute URL of an API path.
 *
 * For the things the browser fetches by itself: an `<img src>` does not go
 * through `apiFetch`, and left relative it would ask the dev server on :5173
 * for an image the API serves on :8080.
 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** Error carrying the API's structured failure body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string>;

  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }

  /** True when the failure was the user's input rather than a fault. */
  get isValidation(): boolean {
    return this.status === 422 || this.status === 400;
  }
}

/**
 * Supplies a bearer token, or null when signed out.
 *
 * The auth layer registers this at startup rather than the client importing
 * the Prelude SDK directly, which keeps this module free of any dependency on
 * how sessions are stored and makes it trivially mockable in tests.
 */
type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

let getToken: TokenProvider = async () => null;
let onUnauthorized: (() => void) | null = null;

/**
 * Registers where access tokens come from.
 *
 * `auth/session` calls this at import time, not from a React effect — see the
 * comment there for why the difference matters. It is separate from the
 * unauthorized handler because the two become available at different moments:
 * the token provider is a module singleton that exists before the first render,
 * while reacting to a dead session needs React state that does not.
 */
export function setTokenProvider(provider: TokenProvider): void {
  getToken = provider;
}

/** Registers what to do when a session turns out to be dead; null unregisters. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export interface RequestOptions {
  method?: string;
  /**
   * Sent as JSON, unless it is a `Blob` — an image upload — which goes up as
   * its own bytes under its own content type.
   */
  body?: unknown;
  /** Skip the Authorization header even when a session exists. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

/**
 * Performs an API request, attaching the access token and decoding the
 * response.
 *
 * On a 401 the token is refreshed once and the request retried: access tokens
 * are short-lived, so an expiry during an ordinary session is routine and
 * should be invisible rather than bouncing the user to a login screen.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options, false);

  if (response.status === 401 && !options.anonymous) {
    const retried = await send(path, options, true);
    if (retried.status === 401) {
      onUnauthorized?.();
    }
    return handle<T>(retried);
  }

  return handle<T>(response);
}

async function send(
  path: string,
  options: RequestOptions,
  forceRefresh: boolean,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };

  if (!options.anonymous) {
    const token = await getToken(forceRefresh);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const payload = await payloadOf(options.body);
  if (payload) headers["Content-Type"] = payload.contentType;

  return fetch(apiUrl(path), {
    method: options.method ?? "GET",
    headers,
    body: payload?.body,
    signal: options.signal,
  });
}

/**
 * The body to send and the content type that describes it, or null for none.
 *
 * A `Blob` — an image being uploaded — is read out into its bytes rather than
 * handed to `fetch` as it is. A Blob is only recognized as one by the fetch
 * implementation that defined it, and an unrecognized one is *stringified*:
 * `"[object Blob]"` goes up as thirteen bytes of text, every byte of the image
 * dropped, and the request looks perfectly well formed doing it. Reading it
 * here is what makes an upload independent of whose Blob it is.
 *
 * Reading it per attempt also keeps the 401 retry above working, since a Blob
 * can be read again where a stream could not.
 */
async function payloadOf(body: unknown): Promise<{ body: BodyInit; contentType: string } | null> {
  if (body === undefined) return null;
  if (body instanceof Blob) {
    return {
      body: await body.arrayBuffer(),
      contentType: body.type || "application/octet-stream",
    };
  }
  return { body: JSON.stringify(body), contentType: "application/json" };
}

async function handle<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "unknown_error",
      body?.error?.message ?? `Request failed with status ${response.status}.`,
      body?.error?.details,
    );
  }

  return payload as T;
}

/**
 * Turns an unknown thrown value into a sentence for the user.
 *
 * Lives beside ApiError rather than in each route: the rule for deciding
 * whether a failure carries a server message worth showing is a property of the
 * error type, and five call sites had drifted copies of it.
 */
export function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/** Per-field validation messages from a failure, or none if it carried no body. */
export function errorDetails(caught: unknown): Record<string, string> {
  return caught instanceof ApiError ? caught.details : {};
}

/**
 * Whether a failed request is worth retrying.
 *
 * 4xx responses will not become successes on retry.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

/** Builds a query string, dropping empty and undefined values. */
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}
