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
// is logged, never returned: distinguishing them only helps a prober.
var ErrInvalidToken = errors.New("invalid access token")

// Claims is the subset of a Prelude access token this application consumes.
type Claims struct {
	// UserID is the `sub` claim (falling back to `user_id`), the join key to
	// users.prelude_user_id — never the email, which a user can change.
	UserID string
	Email  string
	// Scopes are the step-up grants Prelude adds, under its signature, when a
	// challenge completes.
	Scopes []string
}

// HasScope reports whether the token carries a step-up grant.
func (c *Claims) HasScope(scope string) bool {
	return slices.Contains(c.Scopes, scope)
}

// emailClaimNames are checked in order; the name depends on each Prelude app's
// custom-claims mapping.
var emailClaimNames = []string{"email", "email_address", "primary_email"}

// Verifier validates access tokens against the application's JWKS.
type Verifier struct {
	jwksURL string
	issuer  string
	cache   *jwk.Cache
}

// NewVerifier builds a verifier backed by a self-refreshing JWKS cache. The key
// set is fetched here so a misconfigured Prelude host fails at startup.
func NewVerifier(ctx context.Context, jwksURL, issuer string) (*Verifier, error) {
	cache, err := jwk.NewCache(ctx, httprc.NewClient())
	if err != nil {
		return nil, fmt.Errorf("create jwks cache: %w", err)
	}

	// An unknown key ID triggers a refetch; WithMinInterval keeps a burst of
	// them from flooding Prelude.
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

// issuerAccepted reports whether a token's `iss` identifies this application,
// comparing hosts only: Prelude's `iss` is the bare host while its metadata
// advertises `https://`.
func (v *Verifier) issuerAccepted(issuer string) bool {
	return issuerHost(issuer) != "" && issuerHost(issuer) == issuerHost(v.issuer)
}

func issuerHost(issuer string) string {
	host := strings.TrimPrefix(strings.TrimPrefix(issuer, "https://"), "http://")
	return strings.TrimSuffix(host, "/")
}

// Verify parses and validates a raw bearer token. There is no audience check:
// Prelude does not document an `aud` on access tokens.
func (v *Verifier) Verify(ctx context.Context, raw string) (*Claims, error) {
	set, err := v.cache.Lookup(ctx, v.jwksURL)
	if err != nil {
		// A JWKS the verifier cannot reach is a server fault, not a bad token,
		// and must not be reported to the client as an authentication failure.
		return nil, fmt.Errorf("look up jwks: %w", err)
	}

	// Not jwt.WithIssuer, which needs one exact spelling; see issuerAccepted.
	token, err := jwt.Parse([]byte(raw),
		jwt.WithKeySet(set),
		jwt.WithValidate(true),
		// Tokens set `nbf` to issue time, so any clock drift would reject a
		// fresh one.
		jwt.WithAcceptableSkew(15*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	issuer, ok := token.Issuer()
	if !ok || !v.issuerAccepted(issuer) {
		return nil, fmt.Errorf("%w: issuer %q is not %q", ErrInvalidToken, issuer, v.issuer)
	}

	claims := &Claims{}

	// `sub` is the join key, not `user_id` (Prelude's internal UUID); joining on
	// `user_id` matches nothing and re-provisions a duplicate user.
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

// scopesFrom reads the step-up grants off a token. The OAuth `scope` claim is
// usually a space-delimited string but may be a list; absent means no grants.
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
