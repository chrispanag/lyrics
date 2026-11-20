import { describe, expect, it } from "vitest";

import { API_SCOPES, apiScopeNames } from "./apiScopes";
import { openApiDocument } from "./openapiDocument";
import { apiResource, originResource } from "./protectedResource";

describe("protected resource metadata", () => {
  it("names the origin and lists every scope", () => {
    expect(originResource()).toEqual({
      resource: "https://songfolio.live",
      authorization_servers: ["https://auth.songfolio.live"],
      scopes_supported: apiScopeNames(),
      bearer_methods_supported: ["header"],
      resource_name: "Songfolio",
      resource_documentation: "https://songfolio.live/openapi.json",
    });
    expect(apiScopeNames()).toContain("email:verify");
    expect(apiScopeNames()).toContain("catalog:read");
  });

  it("names the API when the resource path is /api/v1", () => {
    expect(apiResource().resource).toBe("https://songfolio.live/api/v1");
    expect(apiResource().resource_name).toBe("Songfolio API");
    expect(apiResource().scopes_supported).toEqual(apiScopeNames());
  });
});

describe("OpenAPI document", () => {
  const document = openApiDocument();
  const schemes = document.components as {
    securitySchemes: {
      oauth2: { type: string; flows: { authorizationCode: { scopes: typeof API_SCOPES } } };
    };
  };
  const paths = document.paths as Record<string, Record<string, { security?: unknown }>>;

  it("is OpenAPI 3.1 with the oauth2 scopes the metadata publishes", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "https://songfolio.live/api/v1" }]);
    expect(schemes.securitySchemes.oauth2.type).toBe("oauth2");
    expect(schemes.securitySchemes.oauth2.flows.authorizationCode.scopes).toEqual(API_SCOPES);
    expect(schemes.securitySchemes.oauth2.flows.authorizationCode).toMatchObject({
      authorizationUrl: "https://auth.songfolio.live/v1/session/oauth/authorize",
      tokenUrl: "https://auth.songfolio.live/v1/session/oauth/token",
    });
  });

  it("describes the public catalog and the step-up scope", () => {
    expect(paths["/songs"]?.get?.security).toEqual([{ oauth2: ["catalog:read"] }, {}]);
    expect(paths["/auth/verify-email"]?.post?.security).toEqual([{ oauth2: ["email:verify"] }]);
    expect(paths["/health"]?.get?.security).toEqual([]);
    expect(paths["/songs/{id}"]?.get).toBeDefined();
    expect(paths["/lists/{id}"]?.get).toBeDefined();
  });
});
