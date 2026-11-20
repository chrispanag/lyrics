import { HTML, MARKDOWN, preferredType } from "@/lib/accept";
import { markdownFor } from "@/lib/agentDocument";

/**
 * What the proxy should do with one request. HTML (and Next's own flight
 * requests) pass through. Markdown is answered here, because a Server
 * Component page cannot change its content type. A client that rejects both
 * representations gets 406.
 */

export type Decision =
  | { kind: "pass" }
  | { kind: "unacceptable" }
  | { kind: "markdown"; status: number; body: string };

export interface NegotiateRequest {
  method: string;
  pathname: string;
  /** The raw Accept header, or null when the request sent none. */
  accept: string | null;
  /** A Next.js client navigation or prefetch, which must reach the renderer. */
  nextFlight: boolean;
}

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

/** A static file (`/llms.txt`, `/openapi.json`) keeps the bytes Next already serves. */
function hasExtension(pathname: string): boolean {
  const segment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return segment.includes(".");
}

/**
 * Choose a representation. Only GET and HEAD negotiate; everything else is the
 * app's own behavior.
 */
export async function decide(request: NegotiateRequest): Promise<Decision> {
  if (request.method !== "GET" && request.method !== "HEAD") return { kind: "pass" };
  if (request.nextFlight) return { kind: "pass" };

  const pathname = normalize(request.pathname);
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/.well-known/") ||
    hasExtension(pathname)
  ) {
    return { kind: "pass" };
  }

  const chosen = preferredType(request.accept);
  if (chosen === HTML) return { kind: "pass" };
  if (chosen !== MARKDOWN) return { kind: "unacceptable" };

  const document = await markdownFor(pathname);
  return { kind: "markdown", status: document.status, body: document.body };
}
