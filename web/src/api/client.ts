import type { ApiErrorBody } from "@/lib/types";

// Browser: production uses its own origin (never bake in a hostname); other
// modes, vitest's "test" included, fall back to :8080. An explicit
// NEXT_PUBLIC_API_BASE_URL wins, even "" (`make mobile`), hence `??`.
//
// Server: "" is not a URL, so Node reads API_ORIGIN, a run-time platform value
// that is never NEXT_PUBLIC_. It must not fall back through
// NEXT_PUBLIC_API_BASE_URL, which `make mobile` empties. See CLAUDE.md, "What
// the server says while the app is still client-only".
const LOCAL_API = "http://localhost:8080";

const API_BASE =
  typeof window === "undefined"
    ? (process.env.API_ORIGIN ?? LOCAL_API)
    : (process.env.NEXT_PUBLIC_API_BASE_URL ??
      (process.env.NODE_ENV !== "production" ? LOCAL_API : ""));

/** The absolute URL of an API path, for what bypasses `apiFetch` (an `<img src>`). */
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
 * Whether the API itself said there is no such record. A bare 404 from whatever
 * sits in front of the API, or the router's `no_route` when an ingress drops
 * the /api prefix, is an outage, and an outage must not 404 or deindex a page.
 */
export function isNotFound(caught: unknown): boolean {
  return caught instanceof ApiError && caught.status === 404 && caught.code === "not_found";
}

/**
 * How long a server render waits on one API read before rendering without it.
 * With no `loading.tsx`, an in-app link waits on these reads too, so an API
 * that hangs rather than fails would otherwise freeze the old screen until the
 * socket gives up — minutes. Past the budget the read counts as failed, never
 * as a 404: the page is served, nothing is handed over, and the browser asks
 * for itself.
 */
const READ_BUDGET_MS = 3000;

/** A server render's read: a guest by construction, on a fresh `READ_BUDGET_MS` clock. */
export function guestRead() {
  return { anonymous: true, signal: AbortSignal.timeout(READ_BUDGET_MS) } as const;
}

/** Supplies a bearer token, or null when signed out. Registered by the auth layer. */
type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

let getToken: TokenProvider = async () => null;
let onUnauthorized: (() => void) | null = null;

/**
 * Registers where access tokens come from. `auth/session` calls this at import
 * time, not from an effect; see there.
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
  /**
   * Server only (Next's `fetch` extension): seconds this response may be reused.
   * Omitted, nothing is cached. Per call site, since staleness is wrong for the
   * app. A segment `revalidate` export does nothing on a dynamic route.
   */
  revalidate?: number;
}

/**
 * Performs an API request, attaching the access token and decoding the
 * response. A 401 forces one token refresh and retry.
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
    body: payload?.body ?? null,
    signal: options.signal ?? null,
    // Spread so an uncached request carries no `next` key at all.
    ...(options.revalidate === undefined ? {} : { next: { revalidate: options.revalidate } }),
  });
}

/**
 * The body to send and its content type, or null for none.
 *
 * A `Blob` is read into bytes: a fetch that does not recognize another
 * implementation's Blob silently sends `"[object Blob]"` instead.
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

/** Turns an unknown thrown value into a sentence for the user. */
export function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/** Per-field validation messages from a failure, or none if it carried no body. */
export function errorDetails(caught: unknown): Record<string, string> {
  return caught instanceof ApiError ? caught.details : {};
}

/** Whether a failed request is worth retrying; a 4xx never is. */
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
