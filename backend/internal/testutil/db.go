package testutil

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file" // registers the file:// migration source
	_ "github.com/jackc/pgx/v5/stdlib"                   // registers the "pgx" database/sql driver

	"github.com/christos/lyrics/backend/internal/store"
)

// defaultTestDatabaseURL points at the Compose database on its published port.
const defaultTestDatabaseURL = "postgres://lyrics:lyrics@localhost:5433/lyrics?sslmode=disable" //nolint:gosec // G101: the local Compose database's throwaway credentials.

// prepareDatabase creates and migrates this binary's database once.
var prepareDatabase = sync.OnceValue(func() error {
	if err := ensureDatabase(); err != nil {
		return err
	}
	return runMigrations(TestDatabaseURL())
})

// baseDatabaseURL is the administrative connection string.
func baseDatabaseURL() string {
	if raw := os.Getenv("TEST_DATABASE_URL"); raw != "" {
		return raw
	}
	return defaultTestDatabaseURL
}

// TestDatabaseURL returns a connection string pointing at a database private to
// this test binary, since packages run in parallel and TRUNCATE each other's
// fixtures otherwise. The name is stable across runs.
func TestDatabaseURL() string {
	base := baseDatabaseURL()

	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	u.Path = "/" + testDatabaseName()
	return u.String()
}

// testDatabaseName derives a per-package database name from the test binary.
func testDatabaseName() string {
	name := strings.TrimSuffix(filepath.Base(os.Args[0]), ".test")

	sanitized := make([]rune, 0, len(name))
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			sanitized = append(sanitized, r)
		}
	}
	if len(sanitized) == 0 {
		return "lyrics_test"
	}
	return "lyrics_test_" + string(sanitized)
}

// ensureDatabase creates this binary's database if it does not exist yet.
func ensureDatabase() error {
	// Bounded, since a wedged server would otherwise hang every test binary.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	admin, err := sql.Open("pgx", baseDatabaseURL())
	if err != nil {
		return err
	}
	defer func() { _ = admin.Close() }()

	name := testDatabaseName()

	var exists bool
	err = admin.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}

	// CREATE DATABASE cannot be parameterized; the name is sanitized to
	// [a-z0-9_], so interpolating it is safe.
	if _, err := admin.ExecContext(ctx, `CREATE DATABASE `+name); err != nil {
		// A parallel test binary may have won the race; that is fine.
		if strings.Contains(err.Error(), "already exists") {
			return nil
		}
		return err
	}
	return nil
}

// NewStore returns a store connected to a freshly migrated, empty database.
// Tests skip, not fail, when no database is reachable; CI and `make test` start one.
func NewStore(t *testing.T) *store.Store {
	t.Helper()

	if err := requireDatabase(); err != nil {
		t.Skipf("integration test skipped: no database at %s (%v)\n"+
			"start one with `make up`, or set TEST_DATABASE_URL", baseDatabaseURL(), err)
	}

	if err := prepareDatabase(); err != nil {
		t.Fatalf("prepare test database: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	st, err := store.New(ctx, TestDatabaseURL())
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	t.Cleanup(st.Close)

	truncate(t, st)
	return st
}

// requireDatabase reports whether a PostgreSQL server is reachable at all.
func requireDatabase() error {
	db, err := sql.Open("pgx", baseDatabaseURL())
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return db.PingContext(ctx)
}

// runMigrations brings the test database up to the latest schema.
//
// Not a pgxpool: golang-migrate holds a connection for its advisory lock until
// Close, and draining a pool around that blocks forever. The named return lets
// the deferred Close report a failure.
func runMigrations(databaseURL string) (err error) {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return err
	}

	m, err := migrate.NewWithDatabaseInstance("file://"+migrationsDir(), "postgres", driver)
	if err != nil {
		return err
	}
	// Releases the advisory-lock connection.
	defer func() {
		if srcErr, dbErr := m.Close(); srcErr != nil || dbErr != nil {
			err = errors.Join(err, srcErr, dbErr)
		}
	}()

	if upErr := m.Up(); upErr != nil && !errors.Is(upErr, migrate.ErrNoChange) {
		return upErr
	}
	return nil
}

// migrationsDir locates the migrations directory relative to this source file,
// so tests work regardless of the working directory the runner chooses.
func migrationsDir() string {
	_, thisFile, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations")
}

// truncate empties every table between tests; cheaper than rebuilding the
// schema.
func truncate(t *testing.T, st *store.Store) {
	t.Helper()

	_, err := st.Pool().Exec(context.Background(),
		`TRUNCATE songs, people, genres, users, lists, list_items,
		          song_credits, song_genres, recordings, recording_credits,
		          song_popularity, song_clicks
		          RESTART IDENTITY CASCADE`)
	if err != nil {
		t.Fatalf("truncate tables: %v", err)
	}
}
