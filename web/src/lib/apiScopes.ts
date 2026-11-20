/**
 * OAuth scopes the API publishes for least-privilege clients.
 *
 * `email:verify` is the step-up scope the API checks on the bearer token
 * (`EmailVerifyScope` in Go, `EMAIL_VERIFY_SCOPE` in the auth provider). The
 * others name the access an agent should request. Catalog reads also answer
 * with no token. Writes are still authorized by the account's role — user,
 * contributor, or admin — which Prelude does not put on the token. Register
 * these names as allowed scopes in the Prelude application before an
 * authorization server will grant them; a browser session is not rejected for
 * omitting them.
 *
 * The same map is the OpenAPI security scheme and `scopes_supported` on the
 * protected-resource metadata. The descriptions have to stay identical.
 */
export const API_SCOPES = {
  "catalog:read":
    "Read songs, people, genres, and public lists. These routes also answer with no token.",
  "account:read": "Read the signed-in account (GET /me).",
  "account:write":
    "Update the signed-in profile and avatar. The account's email must already be verified.",
  "email:verify":
    "Step-up grant that proves control of the account email. POST /auth/verify-email requires this scope on the bearer token.",
  "lists:read": "Read the signed-in user's lists. The account's email must already be verified.",
  "lists:write":
    "Create and edit the signed-in user's lists. The account's email must already be verified.",
  "catalog:write":
    "Create songs, people, and genres, and edit songs this account created. Requires the contributor role.",
  "catalog:admin": "Edit or delete any catalog record and manage users. Requires the admin role.",
} as const;

export type ApiScope = keyof typeof API_SCOPES;

/** Scope names, in declaration order, for `scopes_supported`. */
export function apiScopeNames(): ApiScope[] {
  return Object.keys(API_SCOPES) as ApiScope[];
}
