// Package testutil provides shared fixtures for the test suite.
package testutil

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v3/jwa"
	"github.com/lestrrat-go/jwx/v3/jwk"
	"github.com/lestrrat-go/jwx/v3/jwt"
)

// TokenIssuer serves a JWKS over httptest and mints tokens against it.
//
// Testing the auth path against a locally generated key set rather than live
// Prelude is what makes expiry, wrong-issuer, and wrong-key cases reachable at
// all: none of them can be produced on demand from a real identity provider.
type TokenIssuer struct {
	Server  *httptest.Server
	Issuer  string
	JWKSURL string

	privateKey jwk.Key
}

// NewTokenIssuer starts a JWKS server. It is closed automatically on cleanup.
func NewTokenIssuer(t *testing.T) *TokenIssuer {
	t.Helper()

	raw, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}

	private, err := jwk.Import(raw)
	if err != nil {
		t.Fatalf("import private key: %v", err)
	}
	if err := private.Set(jwk.KeyIDKey, "test-key-1"); err != nil {
		t.Fatalf("set kid: %v", err)
	}
	if err := private.Set(jwk.AlgorithmKey, jwa.RS256()); err != nil {
		t.Fatalf("set alg: %v", err)
	}

	public, err := jwk.PublicKeyOf(private)
	if err != nil {
		t.Fatalf("derive public key: %v", err)
	}
	set := jwk.NewSet()
	if err := set.AddKey(public); err != nil {
		t.Fatalf("add public key: %v", err)
	}

	issuer := &TokenIssuer{privateKey: private}

	issuer.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(set); err != nil {
			t.Errorf("encode jwks: %v", err)
		}
	}))
	t.Cleanup(issuer.Server.Close)

	issuer.Issuer = issuer.Server.URL
	issuer.JWKSURL = issuer.Server.URL + "/.well-known/jwks.json"
	return issuer
}

// TokenOptions describes a token to mint. The zero value produces a valid token.
type TokenOptions struct {
	UserID string
	Email  string
	// Issuer overrides the default, for testing issuer rejection.
	Issuer string
	// Expiry overrides the default one-hour lifetime; a past value produces an
	// expired token.
	Expiry time.Time
	// UserIDClaim overrides the `user_id` claim independently of Subject, to
	// reproduce Prelude's real shape where the two are different identifiers.
	UserIDClaim string
	// OmitSubject drops `sub`.
	OmitSubject bool
	// OmitEmail drops every email claim.
	OmitEmail bool
	// Subject overrides `sub`.
	Subject string
	// Scopes are step-up grants, rendered as the space-delimited `scope` claim
	// Prelude uses. Empty means no claim at all, which is what an ordinary
	// session token looks like.
	Scopes []string
}

// Sign mints a token with the issuer's key.
func (ti *TokenIssuer) Sign(t *testing.T, opts TokenOptions) string {
	t.Helper()

	if opts.UserID == "" {
		opts.UserID = "usr_test_default"
	}
	if opts.Email == "" {
		opts.Email = "user@example.com"
	}
	if opts.Issuer == "" {
		opts.Issuer = ti.Issuer
	}
	if opts.Expiry.IsZero() {
		opts.Expiry = time.Now().Add(time.Hour)
	}
	if opts.Subject == "" {
		opts.Subject = opts.UserID
	}

	builder := jwt.NewBuilder().
		Issuer(opts.Issuer).
		IssuedAt(time.Now().Add(-time.Minute)).
		Expiration(opts.Expiry)

	if !opts.OmitSubject {
		builder = builder.Subject(opts.Subject)
	}

	userIDClaim := opts.UserIDClaim
	if userIDClaim == "" {
		userIDClaim = opts.UserID
	}
	builder = builder.Claim("user_id", userIDClaim)
	if !opts.OmitEmail {
		builder = builder.Claim("email", opts.Email)
	}
	if len(opts.Scopes) > 0 {
		builder = builder.Claim("scope", strings.Join(opts.Scopes, " "))
	}

	token, err := builder.Build()
	if err != nil {
		t.Fatalf("build token: %v", err)
	}

	signed, err := jwt.Sign(token, jwt.WithKey(jwa.RS256(), ti.privateKey))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return string(signed)
}

// SignWithForeignKey mints a well-formed token signed by a key that is not in
// the published set, which is what a forged token looks like.
func (ti *TokenIssuer) SignWithForeignKey(t *testing.T, opts TokenOptions) string {
	t.Helper()

	other := NewTokenIssuer(t)
	// Claim our issuer so the only thing wrong is the signing key.
	if opts.Issuer == "" {
		opts.Issuer = ti.Issuer
	}
	return other.Sign(t, opts)
}
