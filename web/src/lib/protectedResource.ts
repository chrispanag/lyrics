import { apiScopeNames } from "@/lib/apiScopes";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * RFC 9728 OAuth protected-resource metadata. The `resource` value is the
 * identifier a client used to build the well-known URL: the origin for
 * `/.well-known/oauth-protected-resource`, and the API base for the path form.
 */

/** Prelude's issuer for this deployment. Matches the authorization-server metadata. */
export const AUTHORIZATION_SERVER = "https://auth.songfolio.live";

export const RESOURCE_DOCUMENTATION = `${SITE_ORIGIN}/openapi.json`;

export interface ProtectedResource {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_name: string;
  resource_documentation: string;
}

/** The metadata document for one resource identifier. */
export function protectedResource(resource: string): ProtectedResource {
  return {
    resource,
    authorization_servers: [AUTHORIZATION_SERVER],
    scopes_supported: apiScopeNames(),
    bearer_methods_supported: ["header"],
    resource_name: resource.endsWith("/api/v1") ? "Songfolio API" : "Songfolio",
    resource_documentation: RESOURCE_DOCUMENTATION,
  };
}

/** The origin's document: `/.well-known/oauth-protected-resource`. */
export function originResource(): ProtectedResource {
  return protectedResource(SITE_ORIGIN);
}

/** The API's document: `/.well-known/oauth-protected-resource/api/v1`. */
export function apiResource(): ProtectedResource {
  return protectedResource(`${SITE_ORIGIN}/api/v1`);
}
