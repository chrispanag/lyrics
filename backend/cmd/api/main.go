// Command api serves the lyrics REST API.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/christos/lyrics/backend/internal/api"
	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/config"
	"github.com/christos/lyrics/backend/internal/prelude"
	"github.com/christos/lyrics/backend/internal/store"
)

func main() {
	// -healthcheck lets the container image act as its own health probe, so the
	// image needs no curl or wget installed.
	healthcheck := flag.Bool("healthcheck", false, "probe the local server and exit")
	flag.Parse()

	if *healthcheck {
		os.Exit(runHealthcheck())
	}

	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		// Logging is not configured yet, and a configuration error must be
		// readable without a JSON parser.
		fmt.Fprintln(os.Stderr, err)
		return errors.New("startup aborted")
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel,
	})))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer st.Close()

	// Fetching the key set here means a wrong PRELUDE_APP_ID fails at startup
	// rather than on the first user's login attempt.
	verifier, err := auth.NewVerifier(ctx, cfg.JWKSURL(), cfg.Issuer())
	if err != nil {
		return fmt.Errorf("initialize token verifier: %w", err)
	}

	preludeClient := prelude.New(cfg.PreludeAPIBase, cfg.PreludeAppID, cfg.PreludeAPIKey)
	authenticator := auth.NewAuthenticator(verifier, st, cfg.IsBootstrapAdmin)
	server := api.NewServer(cfg, st, preludeClient, authenticator)

	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           server.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	serverErr := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", httpServer.Addr, "cors_origins", cfg.CORSOrigins)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	if len(cfg.AdminEmails) == 0 {
		slog.Warn("ADMIN_EMAILS is empty: no account will be granted the admin role, " +
			"and roles can only be changed by an admin")
	}

	select {
	case err := <-serverErr:
		return fmt.Errorf("http server: %w", err)
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	}

	// Give in-flight requests a bounded window to finish before dropping them.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	slog.Info("shutdown complete")
	return nil
}

// runHealthcheck probes the local health endpoint and returns a process exit code.
func runHealthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://" + net.JoinHostPort("127.0.0.1", port) + "/api/v1/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck failed:", err)
		return 1
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck returned status", resp.StatusCode)
		return 1
	}
	return 0
}
