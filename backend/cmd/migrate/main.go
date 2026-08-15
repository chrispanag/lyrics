// Command migrate brings a database up to the current schema and exits.
//
// It exists so a deployment can migrate without the golang-migrate CLI or a
// checkout of the repository: the SQL is compiled into the binary. On App
// Platform it runs as a PRE_DEPLOY job, which finishes before the new API
// containers are allowed to start — the API deliberately does not migrate on
// boot, so nothing else moves the schema forward in production.
//
// Running it concurrently is safe. golang-migrate holds a PostgreSQL advisory
// lock for the duration, so a second invocation waits rather than interleaving.
//
//	migrate                # apply everything pending to $DATABASE_URL
//	migrate -version       # report the current schema version and exit
package main

import (
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver

	"github.com/christos/lyrics/backend/migrations"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
}

func run() (err error) {
	databaseURL := flag.String("database-url", os.Getenv("DATABASE_URL"),
		"target database connection string (default $DATABASE_URL)")
	showVersion := flag.Bool("version", false,
		"print the current schema version and exit without migrating")
	flag.Parse()

	if *databaseURL == "" {
		return errors.New("no database: pass -database-url or set DATABASE_URL")
	}

	src, err := iofs.New(migrations.FS(), ".")
	if err != nil {
		return fmt.Errorf("open embedded migrations: %w", err)
	}

	// A plain database/sql handle rather than a pgxpool, for the same reason
	// the tests use one: golang-migrate keeps a dedicated connection checked
	// out for its advisory lock until the instance is closed, and draining a
	// pool around that blocks forever.
	db, err := sql.Open("pgx", *databaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() { _ = db.Close() }()

	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", src, "postgres", driver)
	if err != nil {
		return fmt.Errorf("initialize migrator: %w", err)
	}
	// Named return so this can report a failure to release the lock; both
	// errors are joined rather than picked between, since either one leaves the
	// schema in a state worth knowing about.
	defer func() {
		if srcErr, dbErr := m.Close(); srcErr != nil || dbErr != nil {
			err = errors.Join(err, srcErr, dbErr)
		}
	}()

	if *showVersion {
		return reportVersion(m)
	}

	switch err := m.Up(); {
	case errors.Is(err, migrate.ErrNoChange):
		// Not a failure: a redeploy with no new migrations is the common case,
		// and exiting non-zero here would block every such deploy.
		fmt.Println("migrate: schema already up to date")
	case err != nil:
		return err
	default:
		fmt.Println("migrate: schema updated")
	}
	return reportVersion(m)
}

// reportVersion prints the applied version, flagging a dirty schema — a
// migration that failed partway leaves the version marked dirty and every
// subsequent run refusing to proceed until someone resolves it by hand.
func reportVersion(m *migrate.Migrate) error {
	version, dirty, err := m.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		fmt.Println("migrate: no migrations applied")
		return nil
	}
	if err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if dirty {
		return fmt.Errorf("schema is dirty at version %d: a previous migration "+
			"failed partway and must be resolved before this one can run", version)
	}
	fmt.Printf("migrate: at version %d\n", version)
	return nil
}
