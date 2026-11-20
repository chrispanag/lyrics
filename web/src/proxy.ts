import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { decide, type NegotiateRequest } from "@/lib/negotiate";

/**
 * Content negotiation for documents. Markdown is answered here; HTML falls
 * through to the App Router. A route under `app/api/` would never be reached
 * in production — the ingress sends `/api` to the Go service — so this does
 * not rewrite into one.
 */

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

function from(request: NextRequest): NegotiateRequest {
  const accept = request.headers.get("accept");
  return {
    method: request.method,
    pathname: request.nextUrl.pathname,
    accept,
    nextFlight:
      request.headers.has("rsc") ||
      request.headers.has("next-router-prefetch") ||
      request.headers.has("next-router-segment-prefetch") ||
      (accept?.includes("text/x-component") ?? false),
  };
}

export async function proxy(request: NextRequest) {
  const decision = await decide(from(request));

  if (decision.kind === "pass") return NextResponse.next();

  if (decision.kind === "unacceptable") {
    return new Response(
      "Not Acceptable\n\nAvailable representations: text/html, text/markdown.\n",
      {
        status: 406,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          Vary: "Accept",
          "Cache-Control": "no-store",
          ...SECURITY_HEADERS,
        },
      },
    );
  }

  return new Response(request.method === "HEAD" ? null : decision.body, {
    status: decision.status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

export const config = {
  // Static files and Next's own assets skip negotiation. Documents, including
  // addresses no route owns, are matched so a Markdown 404 can be a 404.
  matcher: ["/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
