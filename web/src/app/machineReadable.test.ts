import { describe, expect, it } from "vitest";

import { GET as apiMetadata } from "@/app/.well-known/oauth-protected-resource/api/v1/route";
import { GET as originMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as openApi } from "@/app/openapi.json/route";
import { API_SCOPES } from "@/lib/apiScopes";

describe("machine-readable routes", () => {
  it("serves the OpenAPI document as JSON", async () => {
    const response = openApi();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.components.securitySchemes.oauth2.flows.authorizationCode.scopes).toEqual(
      API_SCOPES,
    );
  });

  it("serves protected-resource metadata for the origin and the API", async () => {
    const origin = originMetadata();
    const api = apiMetadata();

    expect(origin.headers.get("content-type")).toContain("application/json");
    expect(await origin.json()).toMatchObject({
      resource: "https://songfolio.live",
      scopes_supported: expect.arrayContaining(["catalog:read", "email:verify"]),
      bearer_methods_supported: ["header"],
    });
    expect(await api.json()).toMatchObject({ resource: "https://songfolio.live/api/v1" });
  });
});
