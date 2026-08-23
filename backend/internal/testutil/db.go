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
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver

	"github.com/christos/lyrics/backend/internal/store"
)

// defaultTestDatabaseURL points at the Compose database on its published port.
// Integration tests run against a real PostgreSQL because everything they cover
// — the generated search vector, the denormalization triggers, ts_headline,
// trigram ranking — lives in the database and cannot be exercised by a fake.
const defaultTestDatabaseURL = "postgres://lyrics:lyrics@localhost:5433/lyrics?sslmode=disable"

var (
	migrateOnce sync.Once
	migrateErr  error
)

// baseDatabaseURL is the administrative connection string.
func baseDatabaseURL() string {
	if url := os.Getenv("TEST_DATABASE_URL"); url != "" {
		return url
	}
	return defaultTestDatabaseURL
}

// TestDatabaseURL returns a connection string pointing at a database private to
// this test binary.
//
// `go test ./...` runs packages in parallel, so a single shared database means
// one package's TRUNCATE deletes another package's fixtures mid-test — which
// surfaces as deadlocks and missing rows rather than an obvious conflict. The
// name is derived from the test binary, so it is stable across runs (letting
// the schema be reused) and distinct across packages.
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
	admin, err := sql.Open("pgx", baseDatabaseURL())
	if err != nil {
		return err
	}
	defer func() { _ = admin.Close() }()

	name := testDatabaseName()

	var exists bool
	err = admin.QueryRow(`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)`, name).Scan(&exists)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}

	// CREATE DATABASE cannot be parameterized or run inside a transaction. The
	// name is derived from our own binary path and sanitized to [a-z0-9_], so
	// interpolating it here is safe.
	if _, err := admin.Exec(`CREATE DATABASE ` + name); err != nil {
		// A parallel test binary may have won the race; that is fine.
		if strings.Contains(err.Error(), "already exists") {
			return nil
		}
		return err
	}
	return nil
}

// NewStore returns a store connected to a freshly migrated, empty database.
//
// Tests are skipped rather than failed when no database is reachable, so that
// `go test ./...` stays useful on a machine without Docker running. CI and
// `make test` both start one first.
func NewStore(t *testing.T) *store.Store {
	t.Helper()

	if err := requireDatabase(); err != nil {
		t.Skipf("integration test skipped: no database at %s (%v)\n"+
			"start one with `make up`, or set TEST_DATABASE_URL", baseDatabaseURL(), err)
	}

	migrateOnce.Do(func() {
		if migrateErr = ensureDatabase(); migrateErr != nil {
			return
		}
		migrateErr = runMigrations(TestDatabaseURL())
	})
	if migrateErr != nil {
		t.Fatalf("prepare test database: %v", migrateErr)
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
// A plain database/sql handle rather than a pgxpool: golang-migrate keeps a
// dedicated connection for its advisory lock until the instance is closed, and
// draining a pgxpool while that connection is still checked out blocks forever.
// The return value is named so the deferred Close below can actually report a
// failure — assigning to a local `err` in a defer would be discarded.
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
	// Releases the advisory-lock connection. Both returned errors are reported
	// so a failure here is not silently swallowed.
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

// truncate empties every table between tests.
//
// TRUNCATE ... CASCADE rather than dropping and recreating the schema: the
// schema includes a text search configuration and an IMMUTABLE function that
// are comparatively expensive to rebuild, and rebuilding them per test would
// dominate the runtime.
func truncate(t *testing.T, st *store.Store) {
	t.Helper()

	_, err := st.Pool().Exec(context.Background(),
		`TRUNCATE songs, people, genres, users, lists, list_items,
		          song_credits, song_genres, recordings, recording_credits
		          RESTART IDENTITY CASCADE`)
	if err != nil {
		t.Fatalf("truncate tables: %v", err)
	}
}
