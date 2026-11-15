package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors the service layer maps onto HTTP status codes. Handlers must
// branch on these rather than inspecting driver errors, so the SQL layer stays
// swappable.
var (
	ErrNotFound = errors.New("record not found")
	ErrConflict = errors.New("record already exists")
	// ErrInUse means a RESTRICT-ed reference forbids the deletion. Only the
	// issuing statement can classify a foreign key violation; see
	// execExpectingRow.
	ErrInUse = errors.New("record is still referenced")
	// ErrInvalid means the store rejected the input before touching the
	// database. Handlers check the same rules to name the field; this is the
	// backstop so a drifted rule answers 422, not 500.
	ErrInvalid = errors.New("invalid input")
	// ErrEmailTaken means users.email is held by a different Prelude account.
	// Unlike ErrConflict it is permanent: no retry gets past it. See
	// ProvisionUser.
	ErrEmailTaken = errors.New("email already registered to another account")
)

// PostgreSQL error codes we translate into domain errors.
const (
	pgUniqueViolation     = "23505"
	pgForeignKeyViolation = "23503"
	pgCheckViolation      = "23514"
)

// Store owns the connection pool and exposes the query surface.
type Store struct {
	pool *pgxpool.Pool
}

// New opens a pool and verifies connectivity, so a bad DATABASE_URL fails at
// startup rather than on the first request.
func New(ctx context.Context, databaseURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	cfg.MaxConns = 10
	cfg.MinConns = 1
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 30 * time.Minute
	cfg.HealthCheckPeriod = time.Minute

	// `<%` reads its cutoff from this GUC and is the only fuzzy form the GIN
	// trigram indexes answer; `word_similarity(a, b) >= x` forces a seq scan.
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx,
			fmt.Sprintf("SET pg_trgm.word_similarity_threshold = %v", wordSimilarityThreshold))
		return err
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases every pooled connection.
func (s *Store) Close() { s.pool.Close() }

// Ping reports whether the database is reachable. Used by the health endpoint.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Pool exposes the underlying pool for tests that need direct SQL access.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// inTx runs fn inside a transaction, rolling back on error or panic.
func (s *Store) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		// Rollback after a successful Commit is a no-op, so this is safe to
		// call unconditionally and still covers the panic path.
		_ = tx.Rollback(ctx)
	}()

	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

// defaultLimit is the page size when a caller passes none. Keep equal to
// httpx.DefaultLimit.
const defaultLimit = 20

// clampLimit applies the default page size to an unset or nonsensical limit.
func clampLimit(n int) int {
	if n <= 0 {
		return defaultLimit
	}
	return n
}

// requireName trims a display name and rejects a blank one.
func requireName(kind, raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", fmt.Errorf("%w: %s name must not be empty", ErrInvalid, kind)
	}
	return name, nil
}

// execExpectingRow runs a DELETE that must affect an existing row, mapping
// "affected nothing" onto ErrNotFound. DELETE-only: there a foreign key
// violation can only mean ErrInUse, while on an INSERT it means a missing
// referent (translateErr's ErrNotFound).
func (s *Store) execExpectingRow(ctx context.Context, op, query string, args ...any) error {
	tag, err := s.pool.Exec(ctx, query, args...)
	if err != nil {
		if isPGCode(err, pgForeignKeyViolation) {
			return fmt.Errorf("%s: %w", op, ErrInUse)
		}
		return fmt.Errorf("%s: %w", op, translateErr(err))
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// queryAll runs a listing query and collects every row through the scan
// helper. No rows yields nil; callers needing `[]` in JSON normalize it.
func queryAll[T any](ctx context.Context, s *Store, kind, query string, scan func(pgx.Row, *T) error, args ...any) ([]T, error) {
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query %s: %w", kind, translateErr(err))
	}
	defer rows.Close()

	var out []T
	for rows.Next() {
		var v T
		if err := scan(rows, &v); err != nil {
			return nil, fmt.Errorf("scan %s: %w", kind, err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// count runs a COUNT query for the total that accompanies a paginated listing.
func (s *Store) count(ctx context.Context, op, query string, args ...any) (int, error) {
	var total int
	if err := s.pool.QueryRow(ctx, query, args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("%s: %w", op, translateErr(err))
	}
	return total, nil
}

// isPGCode reports whether err carries the given PostgreSQL SQLSTATE.
func isPGCode(err error, code string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == code
}

// isUniqueViolation reports whether err is a uniqueness failure on one named
// constraint, which translateErr's ErrConflict does not distinguish.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) &&
		pgErr.Code == pgUniqueViolation && pgErr.ConstraintName == constraint
}

// translateErr converts driver-specific failures into the sentinel errors above.
func translateErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case pgUniqueViolation:
			return fmt.Errorf("%w: %s", ErrConflict, pgErr.ConstraintName)
		case pgForeignKeyViolation:
			// A reference to a row that does not exist reads to the caller as a
			// missing record, not as a server fault.
			return fmt.Errorf("%w: %s", ErrNotFound, pgErr.ConstraintName)
		case pgCheckViolation:
			return fmt.Errorf("constraint %s violated: %w", pgErr.ConstraintName, err)
		}
	}
	return err
}
