import type { ApiErrorBody } from "@/lib/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

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

export function configureApi(options: {
  tokenProvider: TokenProvider;
  onUnauthorized?: () => void;
}): void {
  getToken = options.tokenProvider;
  onUnauthorized = options.onUnauthorized ?? null;
}

export interface RequestOptions {
  method?: string;
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
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
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
