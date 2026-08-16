// Package auth verifies Prelude access tokens and resolves them to local
// principals carrying this application's authorization.
package auth

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/lestrrat-go/httprc/v3"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

// ErrInvalidToken covers every reason a token was rejected. The specific cause
// is logged but never returned to the client: distinguishing "expired" from
// "bad signature" from "wrong issuer" only helps someone probing the endpoint.
var ErrInvalidToken = errors.New("invalid access token")

// Claims is the subset of a Prelude access token this application consumes.
type Claims struct {
	// UserID is Prelude's stable identifier for the account, taken from the
	// `sub` claim (falling back to the `user_id` claim). The order matters and
	// is explained at the point of use: `user_id` carries Prelude's internal
	// UUID, which never matches the stored `usr_...` id. This is the join key
	// to the local users table — never the email, which a user can change.
	UserID string
	Email  string
	// Scopes are the step-up grants on this token. Prelude adds one when a
	// challenge completes, which is how this application learns that something
	// was proven in the browser without having to take the browser's word for
	// it: the claim is inside a signature only Prelude can produce.
	Scopes []string
}

// HasScope reports whether the token carries a step-up grant.
func (c *Claims) HasScope(scope string) bool {
	return slices.Contains(c.Scopes, scope)
}

// emailClaimNames are checked in order. Prelude's token contents are configured
// per application via the custom-claims mapping rather than fixed, so the exact
// name depends on how the app was set up; these are the conventional spellings.
var emailClaimNames = []string{"email", "email_address", "primary_email"}

// Verifier validates access tokens against the application's JWKS.
type Verifier struct {
	jwksURL string
	issuer  string
	cache   *jwk.Cache
}

// NewVerifier builds a verifier backed by a self-refreshing JWKS cache.
//
// The key set is fetched once here so a misconfigured PRELUDE_APP_ID fails at
// startup rather than on the first user login.
func NewVerifier(ctx context.Context, jwksURL, issuer string) (*Verifier, error) {
	cache, err := jwk.NewCache(ctx, httprc.NewClient())
	if err != nil {
		return nil, fmt.Errorf("create jwks cache: %w", err)
	}

	// Prelude rotates signing keys on its own schedule, and a token signed with
	// a key we have not seen must trigger a refetch rather than a rejection.
	// WithMinInterval bounds how often that can happen so a burst of unknown
	// key IDs cannot turn into a request flood against Prelude.
	if err := cache.Register(ctx, jwksURL,
		jwk.WithMinInterval(15*time.Minute),
		jwk.WithMaxInterval(24*time.Hour),
	); err != nil {
		return nil, fmt.Errorf("register jwks url: %w", err)
	}

	fetchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if _, err := cache.Refresh(fetchCtx, jwksURL); err != nil {
		return nil, fmt.Errorf("fetch jwks from %s: %w", jwksURL, err)
	}

	return &Verifier{jwksURL: jwksURL, issuer: issuer, cache: cache}, nil
}

// issuerAccepted reports whether a token's `iss` identifies this application.
//
// Comparison is on the host alone. Both spellings — with and without a scheme —
// denote the same issuer, and which one appears is Prelude's choice rather than
// ours; accepting both costs nothing, because the signature is what actually
// establishes provenance. The check still rejects a token minted for a
// different application, which is its real purpose.
func (v *Verifier) issuerAccepted(issuer string) bool {
	return issuerHost(issuer) != "" && issuerHost(issuer) == issuerHost(v.issuer)
}

func issuerHost(issuer string) string {
	host := strings.TrimPrefix(strings.TrimPrefix(issuer, "https://"), "http://")
	return strings.TrimSuffix(host, "/")
}

// Verify parses and validates a raw bearer token.
//
// Notably absent is an audience check: the Prelude documentation does not state
// that access tokens carry an `aud`, and asserting one we have not confirmed
// would reject every valid token. Issuer and signature are the real controls.
func (v *Verifier) Verify(ctx context.Context, raw string) (*Claims, error) {
	set, err := v.cache.Lookup(ctx, v.jwksURL)
	if err != nil {
		// A JWKS the verifier cannot reach is a server fault, not a bad token,
		// and must not be reported to the client as an authentication failure.
		return nil, fmt.Errorf("look up jwks: %w", err)
	}

	// The issuer is checked below rather than with jwt.WithIssuer, which only
	// accepts one exact string. Prelude's OAuth metadata advertises the issuer
	// with a scheme ("https://<app>.session.prelude.dev") while the access token
	// carries the bare host, so pinning either spelling alone rejects every real
	// token with a message that reads as "expired".
	token, err := jwt.Parse([]byte(raw),
		jwt.WithKeySet(set),
		jwt.WithValidate(true),
		// Prelude access tokens are short-lived (about a minute) and carry an
		// `nbf` equal to their issue time, so even a second of clock drift
		// against Prelude's clock would reject a token that has only just been
		// issued. A small tolerance absorbs ordinary NTP-level drift without
		// meaningfully extending a token's life.
		jwt.WithAcceptableSkew(15*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}

	issuer, ok := token.Issuer()
	if !ok || !v.issuerAccepted(issuer) {
		return nil, fmt.Errorf("%w: issuer %q is not %q", ErrInvalidToken, issuer, v.issuer)
	}

	claims := &Claims{}

	// `sub` is the join key, not `user_id`.
	//
	// Both are present, and they are different identifiers: `sub` is the
	// `usr_...` id the Management API returns when creating a user — the value
	// stored in users.prelude_user_id — while the `user_id` claim resolves to
	// Prelude's internal UUID for the same account. Preferring `user_id` looks
	// reasonable and silently fails to match any stored user, which then
	// re-provisions them as a duplicate.
	if sub, ok := token.Subject(); ok && sub != "" {
		claims.UserID = sub
	} else {
		// Only reachable if an application's claims mapping drops `sub`.
		var userID string
		if err := token.Get("user_id", &userID); err != nil || userID == "" {
			return nil, fmt.Errorf("%w: token identifies no user", ErrInvalidToken)
		}
		claims.UserID = userID
	}

	for _, name := range emailClaimNames {
		var email string
		if err := token.Get(name, &email); err == nil && email != "" {
			claims.Email = email
			break
		}
	}

	claims.Scopes = scopesFrom(token)

	return claims, nil
}

// scopesFrom reads the step-up grants off a token.
//
// Both spellings are accepted because the claim is an OAuth `scope` — which is
// conventionally one space-delimited string, and is sometimes serialized as a
// list instead. A token with neither simply carries no grants, which is the
// ordinary case: only a session that has just completed a challenge has any.
func scopesFrom(token jwt.Token) []string {
	var single string
	if err := token.Get("scope", &single); err == nil {
		return strings.Fields(single)
	}

	var many []string
	if err := token.Get("scope", &many); err == nil {
		return many
	}
	return nil
}
