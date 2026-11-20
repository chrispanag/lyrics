import { openApiDocument } from "@/lib/openapiDocument";

/** The API description, at the path agents look for. */
export function GET() {
  return Response.json(openApiDocument(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
