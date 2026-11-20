import { originResource } from "@/lib/protectedResource";

/** RFC 9728 metadata for the site origin. */
export function GET() {
  return Response.json(originResource(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
