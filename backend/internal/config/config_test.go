package config

import (
	"strings"
	"testing"
)

// The JWKS URL and the issuer must move together, which is why both derive from
// one value. Prelude's issuer is per-host: `/.well-known/oauth-authorization-server`
// on the custom domain advertises that domain, and the default host advertises
// itself, so a configuration where only one of the two moved verifies real tokens
// against the wrong issuer and answers every request "Access token is invalid or
// has expired" — with a key set that fetched fine at boot.
func TestJWKSURLAndIssuerFollowTheSessionDomain(t *testing.T) {
	tests := []struct {
		name       string
		cfg        Config
		wantJWKS   string
		wantIssuer string
	}{
		{
			name:       "derived from the app id when no session domain is set",
			cfg:        Config{PreludeAppID: "ko8zn4d"},
			wantJWKS:   "https://ko8zn4d.session.prelude.dev/.well-known/jwks.json",
			wantIssuer: "https://ko8zn4d.session.prelude.dev",
		},
		{
			name:       "both follow the custom domain",
			cfg:        Config{PreludeAppID: "ko8zn4d", PreludeSessionDomain: "auth.songfolio.live"},
			wantJWKS:   "https://auth.songfolio.live/.well-known/jwks.json",
			wantIssuer: "https://auth.songfolio.live",
		},
		{
			// The escape hatch tests and offline development rely on: it outranks
			// the session domain, so a locally served key set stays reachable.
			name: "explicit overrides win",
			cfg: Config{
				PreludeAppID:         "ko8zn4d",
				PreludeSessionDomain: "auth.songfolio.live",
				PreludeJWKSURL:       "http://127.0.0.1:9999/jwks.json",
				PreludeIssuer:        "http://127.0.0.1:9999",
			},
			wantJWKS:   "http://127.0.0.1:9999/jwks.json",
			wantIssuer: "http://127.0.0.1:9999",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cfg.JWKSURL(); got != tt.wantJWKS {
				t.Errorf("JWKSURL() = %q, want %q", got, tt.wantJWKS)
			}
			if got := tt.cfg.Issuer(); got != tt.wantIssuer {
				t.Errorf("Issuer() = %q, want %q", got, tt.wantIssuer)
			}
		})
	}
}

// Pasting the domain in with its scheme is the obvious mistake, and both derived
// values add their own — so it is refused at startup rather than reaching the
// verifier as `https://https://auth.songfolio.live`.
func TestLoadRejectsASessionDomainWithAScheme(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/lyrics")
	t.Setenv("PRELUDE_APP_ID", "ko8zn4d")
	t.Setenv("PRELUDE_API_KEY", "sk_test")
	t.Setenv("PRELUDE_SESSION_DOMAIN", "https://auth.songfolio.live")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() accepted a session domain carrying a scheme")
	}
	if !strings.Contains(err.Error(), "PRELUDE_SESSION_DOMAIN") {
		t.Errorf("error does not name the offending variable: %v", err)
	}
}
