// Package config loads and validates process configuration from the environment.
//
// Configuration is read once at startup and validated eagerly: a missing or
// malformed required value is a startup failure, never a surprise at the first
// request that happens to need it.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Config holds every tunable the API needs. Field values are immutable after Load.
type Config struct {
	Port           int
	DatabaseURL    string
	PreludeAppID   string
	PreludeAPIKey  string
	PreludeAPIBase string
	// PreludeSessionDomain is the host serving this application's Prelude session
	// endpoints — a custom domain such as `auth.songfolio.live`, rather than the
	// `<app_id>.session.prelude.dev` default. Both the JWKS URL and the expected
	// issuer derive from it, deliberately from one value: Prelude's issuer is
	// per-host, so a token obtained through the custom domain names that host in
	// `iss`, and a verifier still expecting the default rejects every login.
	PreludeSessionDomain string
	// PreludeJWKSURL and PreludeIssuer override the values derived above. Both
	// are empty in normal operation; tests and offline development point them at
	// a locally served key set, which is the only way to exercise the auth path
	// without live Prelude credentials.
	PreludeJWKSURL  string
	PreludeIssuer   string
	AdminEmails     []string
	CORSOrigins     []string
	LogLevel        slog.Level
	ShutdownTimeout time.Duration
}

// sessionHost is the host the browser authenticates against: the configured
// custom domain, or the per-application default derived from the app ID.
func (c Config) sessionHost() string {
	if c.PreludeSessionDomain != "" {
		return c.PreludeSessionDomain
	}
	return c.PreludeAppID + ".session.prelude.dev"
}

// JWKSURL is the endpoint serving the public keys that sign Prelude access tokens.
func (c Config) JWKSURL() string {
	if c.PreludeJWKSURL != "" {
		return c.PreludeJWKSURL
	}
	return fmt.Sprintf("https://%s/.well-known/jwks.json", c.sessionHost())
}

// Issuer is the expected `iss` claim on every Prelude access token.
func (c Config) Issuer() string {
	if c.PreludeIssuer != "" {
		return c.PreludeIssuer
	}
	return "https://" + c.sessionHost()
}

// IsBootstrapAdmin reports whether an email is listed in ADMIN_EMAILS. Comparison
// is case-insensitive because email local parts are conventionally case-preserving
// but not case-sensitive in practice.
func (c Config) IsBootstrapAdmin(email string) bool {
	needle := strings.ToLower(strings.TrimSpace(email))
	if needle == "" {
		return false
	}
	return slices.Contains(c.AdminEmails, needle)
}

// Load reads configuration from the environment, returning an error that names
// every problem at once rather than failing on the first one. Operators fixing a
// fresh deployment should not have to rerun the process per missing variable.
func Load() (Config, error) {
	var problems []string

	cfg := Config{
		Port:                 envInt("PORT", 8080, &problems),
		DatabaseURL:          os.Getenv("DATABASE_URL"),
		PreludeAppID:         os.Getenv("PRELUDE_APP_ID"),
		PreludeAPIKey:        os.Getenv("PRELUDE_API_KEY"),
		PreludeAPIBase:       envString("PRELUDE_API_BASE", "https://api.prelude.dev"),
		PreludeSessionDomain: strings.TrimSpace(os.Getenv("PRELUDE_SESSION_DOMAIN")),
		PreludeJWKSURL:       strings.TrimSpace(os.Getenv("PRELUDE_JWKS_URL")),
		PreludeIssuer:        strings.TrimSpace(os.Getenv("PRELUDE_ISSUER")),
		AdminEmails:          envCSVLower("ADMIN_EMAILS"),
		CORSOrigins:          envCSV("CORS_ORIGINS"),
		LogLevel:             envLevel("LOG_LEVEL", slog.LevelInfo, &problems),
		ShutdownTimeout:      15 * time.Second,
	}

	if cfg.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required")
	}
	if cfg.PreludeAppID == "" {
		problems = append(problems, "PRELUDE_APP_ID is required (used for the JWKS URL and token issuer)")
	}
	if cfg.PreludeAPIKey == "" {
		problems = append(problems, "PRELUDE_API_KEY is required (used to create users via the Management API)")
	}
	// A bare host, because both derived values add their own scheme and path. A
	// scheme here would otherwise reach the verifier as `https://https://...`.
	if strings.ContainsAny(cfg.PreludeSessionDomain, ":/") {
		problems = append(problems, fmt.Sprintf(
			"PRELUDE_SESSION_DOMAIN must be a bare host such as auth.songfolio.live, got %q",
			cfg.PreludeSessionDomain))
	}
	if len(cfg.CORSOrigins) == 0 {
		cfg.CORSOrigins = []string{"http://localhost:5173"}
	}

	if len(problems) > 0 {
		return Config{}, fmt.Errorf("invalid configuration:\n  - %s", strings.Join(problems, "\n  - "))
	}
	return cfg, nil
}

func envString(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int, problems *[]string) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		*problems = append(*problems, fmt.Sprintf("%s must be an integer, got %q", key, raw))
		return fallback
	}
	return v
}

func envCSV(key string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func envCSVLower(key string) []string {
	values := envCSV(key)
	for i, v := range values {
		values[i] = strings.ToLower(v)
	}
	return values
}

func envLevel(key string, fallback slog.Level, problems *[]string) slog.Level {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(raw)); err != nil {
		*problems = append(*problems, fmt.Sprintf("%s must be one of debug|info|warn|error, got %q", key, raw))
		return fallback
	}
	return level
}
