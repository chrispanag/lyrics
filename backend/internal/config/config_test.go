package config

import (
	"log/slog"
	"slices"
	"strings"
	"testing"
)

// The JWKS URL and the issuer must move together: Prelude's issuer is per-host,
// and a mismatch rejects every real token as "invalid or has expired".
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
			// Tests and offline development rely on overrides outranking the
			// session domain.
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

// A session domain with a scheme is refused at startup, since both derived
// values add their own.
func TestLoadRejectsASessionDomainWithAScheme(t *testing.T) {
	requiredEnv(t)
	t.Setenv("PRELUDE_SESSION_DOMAIN", "https://auth.songfolio.live")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() accepted a session domain carrying a scheme")
	}
	if !strings.Contains(err.Error(), "PRELUDE_SESSION_DOMAIN") {
		t.Errorf("error does not name the offending variable: %v", err)
	}
}

// requiredEnv sets the three variables Load refuses to start without, and
// blanks the optional ones so the developer's own shell cannot leak in.
func requiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://localhost/lyrics")
	t.Setenv("PRELUDE_APP_ID", "ko8zn4d")
	t.Setenv("PRELUDE_API_KEY", "sk_test")
	for _, key := range []string{
		"PORT", "PRELUDE_API_BASE", "PRELUDE_SESSION_DOMAIN", "PRELUDE_JWKS_URL",
		"PRELUDE_ISSUER", "ADMIN_EMAILS", "CORS_ORIGINS", "CLIENT_IP_HEADER", "LOG_LEVEL",
	} {
		t.Setenv(key, "")
	}
}

func TestLoadDefaults(t *testing.T) {
	requiredEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want 8080", cfg.Port)
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Errorf("LogLevel = %v, want info", cfg.LogLevel)
	}
	if cfg.PreludeAPIBase != "https://api.prelude.dev" {
		t.Errorf("PreludeAPIBase = %q", cfg.PreludeAPIBase)
	}
	if !slices.Equal(cfg.CORSOrigins, []string{"http://localhost:5173"}) {
		t.Errorf("CORSOrigins = %q, want the dev server", cfg.CORSOrigins)
	}
	if cfg.AdminEmails != nil {
		t.Errorf("AdminEmails = %q, want none", cfg.AdminEmails)
	}
}

func TestLoadParsesTheEnvironment(t *testing.T) {
	requiredEnv(t)
	t.Setenv("PORT", " 9090 ")
	t.Setenv("LOG_LEVEL", "debug")
	// Blank entries and stray spaces come from hand-edited .env files.
	t.Setenv("ADMIN_EMAILS", " Boss@Example.com, ,ops@example.com,")
	t.Setenv("CORS_ORIGINS", "https://songfolio.live, https://www.songfolio.live")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != 9090 {
		t.Errorf("Port = %d, want 9090", cfg.Port)
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Errorf("LogLevel = %v, want debug", cfg.LogLevel)
	}
	// Lowered, since provisioning compares against a lowered address.
	if want := []string{"boss@example.com", "ops@example.com"}; !slices.Equal(cfg.AdminEmails, want) {
		t.Errorf("AdminEmails = %q, want %q", cfg.AdminEmails, want)
	}
	// Not lowered: an origin is compared verbatim.
	if want := []string{"https://songfolio.live", "https://www.songfolio.live"}; !slices.Equal(cfg.CORSOrigins, want) {
		t.Errorf("CORSOrigins = %q, want %q", cfg.CORSOrigins, want)
	}
}

func TestLoadReportsEveryProblemAtOnce(t *testing.T) {
	requiredEnv(t)
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PRELUDE_API_KEY", "")
	t.Setenv("PORT", "eighty")
	t.Setenv("LOG_LEVEL", "loud")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() accepted an invalid configuration")
	}
	for _, key := range []string{"DATABASE_URL", "PRELUDE_API_KEY", "PORT", "LOG_LEVEL"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error does not name %s: %v", key, err)
		}
	}
}
