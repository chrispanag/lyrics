import { apiResource } from "@/lib/protectedResource";

/**
 * RFC 9728 metadata for the API. The well-known path inserts
 * `/.well-known/oauth-protected-resource` before the resource path `/api/v1`.
 */
export function GET() {
  return Response.json(apiResource(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
