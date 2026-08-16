package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/testutil"
)

func newVerifier(t *testing.T, ti *testutil.TokenIssuer) *auth.Verifier {
	t.Helper()
	v, err := auth.NewVerifier(context.Background(), ti.JWKSURL, ti.Issuer)
	if err != nil {
		t.Fatalf("NewVerifier: %v", err)
	}
	return v
}

func TestVerifyAcceptsValidToken(t *testing.T) {
	ti := testutil.NewTokenIssuer(t)
	v := newVerifier(t, ti)

	token := ti.Sign(t, testutil.TokenOptions{UserID: "usr_abc", Email: "Singer@Example.com"})

	claims, err := v.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.UserID != "usr_abc" {
		t.Errorf("UserID = %q, want %q", claims.UserID, "usr_abc")
	}
	if claims.Email != "Singer@Example.com" {
		t.Errorf("Email = %q, want the claim verbatim", claims.Email)
	}
}

/*
 * The next two tests encode the shape of a real Prelude access token, observed
 * against a live application. Both properties were wrong in the first
 * implementation, and both failed in a way that reads as "your session
 * expired" rather than as a bug.
 */

// A real token issues the bare host, while Prelude's OAuth metadata advertises
// the same issuer with an https:// scheme. Pinning either spelling alone
// rejects every genuine token.
func TestVerifyAcceptsIssuerWithAndWithoutScheme(t *testing.T) {
	ti := testutil.NewTokenIssuer(t)
	host := strings.TrimPrefix(ti.Issuer, "http://")

	for _, configured := range []string{ti.Issuer, host} {
		for _, minted := range []string{ti.Issuer, host} {
			t.Run(configured+" accepts "+minted, func(t *testing.T) {
				v, err := auth.NewVerifier(context.Background(), ti.JWKSURL, configured)
				if err != nil {
					t.Fatalf("NewVerifier: %v", err)
				}

				token := ti.Sign(t, testutil.TokenOptions{Issuer: minted})
				if _, err := v.Verify(context.Background(), token); err != nil {
					t.Errorf("token issued by %q rejected under configured issuer %q: %v",
						minted, configured, err)
				}
			})
		}
	}
}

// `sub` and `user_id` are different identifiers in a real token: `sub` is the
// `usr_...` id the Management API returns and that we store, while `user_id`
// is Prelude's internal UUID. Joining on `user_id` matches no stored user and
// silently re-provisions them as a duplicate.
func TestVerifyJoinsOnSubjectNotUserIDClaim(t *testing.T) {
	ti := testutil.NewTokenIssuer(t)
	v := newVerifier(t, ti)

	token := ti.Sign(t, testutil.TokenOptions{
		Subject:     "usr_01m03cbv4qfyeawazkx74fjzff",
		UserIDClaim: "01a006c5-ec97-7f9c-ae2b-f3e9c8f97def",
	})

	claims, err := v.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.UserID != "usr_01m03cbv4qfyeawazkx74fjzff" {
		t.Errorf("UserID = %q, want the `sub` claim — `user_id` is a different identifier",
			claims.UserID)
	}
}

// Only reachable if an application's claims mapping drops `sub` entirely.
func TestVerifyFallsBackToUserIDClaim(t *testing.T) {
	ti := testutil.NewTokenIssuer(t)
	v := newVerifier(t, ti)

	token := ti.Sign(t, testutil.TokenOptions{
		OmitSubject: true,
		UserIDClaim: "usr_from_claim",
	})

	claims, err := v.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.UserID != "usr_from_claim" {
		t.Errorf("UserID = %q, want the user_id claim", claims.UserID)
	}
}

func TestVerifyRejectsBadTokens(t *testing.T) {
	ti := testutil.NewTokenIssuer(t)
	v := newVerifier(t, ti)

	tests := []struct {
		name  string
		token func() string
	}{
		{
			name:  "expired",
			token: func() string { return ti.Sign(t, testutil.TokenOptions{Expiry: time.Now().Add(-time.Minute)}) },
		},
		{
			// Accepting both issuer spellings must not weaken into accepting a
			// token minted for a different application.
			name:  "wrong issuer",
			token: func() string { return ti.Sign(t, testutil.TokenOptions{Issuer: "https://attacker.example"}) },
		},
		{
			name:  "issuer of another prelude app",
			token: func() string { return ti.Sign(t, testutil.TokenOptions{Issuer: "someoneelse.session.prelude.dev"}) },
		},
		{
			// A structurally perfect token signed by a key we never published.
			name:  "signed by an unknown key",
			token: func() string { return ti.SignWithForeignKey(t, testutil.TokenOptions{}) },
		},
		{
			name:  "not a jwt",
			token: func() string { return "definitely-not-a-token" },
		},
		{
			name:  "empty",
			token: func() string { return "" },
		},
		{
			// The alg-confusion classic: an unsigned token claiming alg=none.
			name: "alg none",
			token: func() string {
				return "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0." +
					"eyJpc3MiOiJodHRwczovL2V4YW1wbGUuY29tIiwic3ViIjoidXNyX3gifQ."
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := v.Verify(context.Background(), tt.token())
			if err == nil {
				t.Fatal("expected verification to fail, got nil error")
			}
			if !errors.Is(err, auth.ErrInvalidToken) {
				t.Errorf("error = %v, want it to wrap ErrInvalidToken so the "+
					"middleware reports 401 rather than 500", err)
			}
		})
	}
}

// A token with no email is valid but cannot provision a new local account, and
// the distinction has to survive verification for the middleware to act on it.
func TestVerifyReportsMissingEmail(t *testing.T) {
	ti := testutil.NewTokenIssuer(t)
	v := newVerifier(t, ti)

	token := ti.Sign(t, testutil.TokenOptions{OmitEmail: true})

	claims, err := v.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.Email != "" {
		t.Errorf("Email = %q, want empty", claims.Email)
	}
	if claims.UserID == "" {
		t.Error("UserID should still be populated")
	}
}

// Step-up grants arrive as the `scope` claim, and reading them is what lets the
// API confirm an email was proven in the browser. The claim is conventionally
// one space-delimited string but is sometimes serialized as a list, and this
// application cannot dictate which — a token whose grants were silently dropped
// would present as a verification that never takes.
//
// Note this pins the parser against tokens minted here, not against Prelude:
// only a live step-up can confirm the spelling Prelude actually sends.
func TestVerifyReadsStepUpScopes(t *testing.T) {
	ti := testutil.NewTokenIssuer(t)
	v := newVerifier(t, ti)

	t.Run("space-delimited claim", func(t *testing.T) {
		token := ti.Sign(t, testutil.TokenOptions{Scopes: []string{"email:verify", "prld:pwd:write"}})

		claims, err := v.Verify(context.Background(), token)
		if err != nil {
			t.Fatalf("Verify: %v", err)
		}
		if !claims.HasScope("email:verify") {
			t.Errorf("Scopes = %v, want it to contain email:verify", claims.Scopes)
		}
		if claims.HasScope("email:verify:other") {
			t.Error("a scope must not match by prefix")
		}
	})

	t.Run("no claim at all", func(t *testing.T) {
		claims, err := v.Verify(context.Background(), ti.Sign(t, testutil.TokenOptions{}))
		if err != nil {
			t.Fatalf("Verify: %v", err)
		}
		if len(claims.Scopes) != 0 {
			t.Errorf("Scopes = %v, want none on an ordinary session token", claims.Scopes)
		}
	})
}

func TestNewVerifierFailsOnUnreachableJWKS(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Port 0 on localhost is never listening.
	_, err := auth.NewVerifier(ctx, "http://127.0.0.1:0/.well-known/jwks.json", "https://example.com")
	if err == nil {
		t.Fatal("expected startup to fail when the key set cannot be fetched")
	}
}

// Prelude access tokens live about a minute and set `nbf` to their issue time,
// so a token issued a moment ahead of our clock must not be rejected as
// not-yet-valid. Expiry beyond the tolerance must still be rejected.
func TestVerifyToleratesSmallClockSkew(t *testing.T) {
	ti := testutil.NewTokenIssuer(t)
	v := newVerifier(t, ti)

	t.Run("token expired within the tolerance still verifies", func(t *testing.T) {
		token := ti.Sign(t, testutil.TokenOptions{Expiry: time.Now().Add(-5 * time.Second)})
		if _, err := v.Verify(context.Background(), token); err != nil {
			t.Errorf("rejected a token 5s past expiry: %v", err)
		}
	})

	t.Run("token expired well beyond the tolerance is rejected", func(t *testing.T) {
		token := ti.Sign(t, testutil.TokenOptions{Expiry: time.Now().Add(-5 * time.Minute)})
		if _, err := v.Verify(context.Background(), token); err == nil {
			t.Error("accepted a token 5 minutes past expiry")
		}
	})
}
