// Command import-songs loads songs into the catalog from the NDJSON
// interchange format produced by scripts/export-old-db.sql.
//
// The whole load runs in one transaction. At this catalog's scale that costs
// nothing and buys the property that matters for a migration: it either lands
// completely or not at all, so a failure halfway through leaves nothing to
// clean up before the next attempt.
//
// Re-running is safe. A song already present — matched on its normalized title
// plus the set of people credited on it — is skipped rather than duplicated,
// because the songs table has no unique constraint to lean on.
//
//	go run ./cmd/import-songs -file songs.ndjson -dry-run
//	go run ./cmd/import-songs -file songs.ndjson
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "import-songs: %v\n", err)
		os.Exit(1)
	}
}

type options struct {
	databaseURL string
	file        string
	dryRun      bool
	duplicates  bool
	actorEmail  string
}

func run() error {
	var opt options
	flag.StringVar(&opt.databaseURL, "database-url", os.Getenv("DATABASE_URL"),
		"target database connection string (default $DATABASE_URL)")
	flag.StringVar(&opt.file, "file", "-", "NDJSON input file, or - for stdin")
	flag.BoolVar(&opt.dryRun, "dry-run", false,
		"validate and report without writing anything")
	flag.BoolVar(&opt.duplicates, "allow-duplicates", false,
		"insert songs even when a matching title and credit set already exists")
	flag.StringVar(&opt.actorEmail, "actor-email", "",
		"attribute imported songs to this existing user (default: no attribution)")
	flag.Parse()

	// Reading and validating everything up front means a malformed file is
	// reported in full before a single row is written, rather than aborting the
	// transaction partway through and reporting only the first problem.
	songs, w, err := load(opt.file)
	if err != nil {
		return err
	}
	if len(songs) == 0 {
		return errors.New("input contained no importable songs")
	}
	w.report(os.Stderr)
	fmt.Fprintf(os.Stderr, "parsed %d songs\n", len(songs))

	if opt.dryRun {
		fmt.Fprintln(os.Stderr, "dry run: nothing written")
		return nil
	}
	if strings.TrimSpace(opt.databaseURL) == "" {
		return errors.New("no target database: set DATABASE_URL or pass -database-url")
	}

	// Ctrl-C aborts the transaction rather than leaving it open against the
	// server until the connection times out.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, opt.databaseURL)
	if err != nil {
		return fmt.Errorf("connect to target: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping target: %w", err)
	}

	return importAll(ctx, pool, songs, opt)
}

// load reads the NDJSON file and validates every record against the target
// schema, returning the rows that can be stored plus the adjustments made.
func load(path string) ([]*song, *warnings, error) {
	in := io.ReadCloser(os.Stdin)
	if path != "-" {
		f, err := os.Open(path)
		if err != nil {
			return nil, nil, fmt.Errorf("open input: %w", err)
		}
		in = f
	}
	// Read-only input: a close failure tells us nothing actionable after the
	// bytes are already parsed.
	defer func() { _ = in.Close() }()

	w := newWarnings()
	var songs []*song

	sc := bufio.NewScanner(in)
	// Lyrics push a record well past bufio's 64KB default line limit.
	sc.Buffer(make([]byte, 0, 1<<20), 16<<20)

	for line := 1; sc.Scan(); line++ {
		raw := strings.TrimSpace(sc.Text())
		if raw == "" {
			continue
		}
		var r record
		if err := json.Unmarshal([]byte(raw), &r); err != nil {
			return nil, nil, fmt.Errorf("line %d: parse: %w", line, err)
		}
		s, err := r.clean(w)
		if err != nil {
			w.add("skipped source id %s: %v", orUnknown(r.SourceID), err)
			continue
		}
		songs = append(songs, s)
	}
	if err := sc.Err(); err != nil {
		return nil, nil, fmt.Errorf("read input: %w", err)
	}
	return songs, w, nil
}

// importAll writes every song in a single transaction.
func importAll(ctx context.Context, pool *pgxpool.Pool, songs []*song, opt options) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op once committed

	actor, err := resolveActor(ctx, tx, opt.actorEmail)
	if err != nil {
		return err
	}

	existing, err := loadFingerprints(ctx, tx)
	if err != nil {
		return err
	}

	im := &importer{
		tx:       tx,
		existing: existing,
		actor:    actor,
		people:   make(map[string]uuid.UUID),
		genres:   make(map[string]uuid.UUID),
	}

	var inserted, skipped int
	for i, s := range songs {
		if !opt.duplicates {
			if _, ok := existing[s.fingerprint()]; ok {
				skipped++
				continue
			}
		}
		if err := im.insert(ctx, s); err != nil {
			return fmt.Errorf("source id %s (%q): %w", orUnknown(s.sourceID), s.title, err)
		}
		// Guard against the input itself carrying the same song twice.
		existing[s.fingerprint()] = struct{}{}
		inserted++

		if (i+1)%100 == 0 {
			fmt.Fprintf(os.Stderr, "  ... %d/%d\n", i+1, len(songs))
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	fmt.Fprintf(os.Stderr,
		"imported %d songs (%d already present, skipped), %d people and %d genres touched\n",
		inserted, skipped, len(im.people), len(im.genres))
	return nil
}

// importer holds the per-run caches. People and genres repeat heavily across a
// catalog — 967 songs share 328 people here — so resolving each name once
// turns thousands of round trips into a few hundred.
type importer struct {
	tx       pgx.Tx
	existing map[string]struct{}
	actor    *uuid.UUID
	people   map[string]uuid.UUID
	genres   map[string]uuid.UUID
}

// insert writes one song with its credits and genres. The denormalized
// credits_text and genres_text columns are left alone deliberately: the
// triggers from migration 000003 maintain them, and the generated search vector
// follows from those.
func (im *importer) insert(ctx context.Context, s *song) error {
	var songID uuid.UUID
	err := im.tx.QueryRow(ctx, `
		INSERT INTO songs (title, alt_title, lyrics, language, youtube_url,
		                   youtube_video_id, release_year, notes, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
		RETURNING id`,
		s.title, s.altTitle, s.lyrics, s.language, s.youTubeURL,
		s.youTubeVideoID, s.releaseYear, s.notes, im.actor).Scan(&songID)
	if err != nil {
		return fmt.Errorf("insert song: %w", err)
	}

	for _, c := range s.credits {
		personID, err := im.person(ctx, c.name)
		if err != nil {
			return err
		}
		_, err = im.tx.Exec(ctx, `
			INSERT INTO song_credits (song_id, person_id, role, position)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (song_id, person_id, role) DO UPDATE SET position = EXCLUDED.position`,
			songID, personID, c.role, c.position)
		if err != nil {
			return fmt.Errorf("credit %q as %s: %w", c.name, c.role, err)
		}
	}

	for _, name := range s.genres {
		genreID, err := im.genre(ctx, name)
		if err != nil {
			return err
		}
		_, err = im.tx.Exec(ctx, `
			INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2)
			ON CONFLICT DO NOTHING`, songID, genreID)
		if err != nil {
			return fmt.Errorf("genre %q: %w", name, err)
		}
	}
	return nil
}

// person resolves a name to an id, creating the person on first sight. The
// conflict target is normalized_name, matching UpsertPerson, so accented and
// unaccented spellings of one artist converge on a single row instead of
// fragmenting their catalog across two.
func (im *importer) person(ctx context.Context, name string) (uuid.UUID, error) {
	key := foldKey(name)
	if id, ok := im.people[key]; ok {
		return id, nil
	}

	var id uuid.UUID
	// DO UPDATE rather than DO NOTHING: DO NOTHING returns no row on conflict,
	// which would make the common "already exists" path fail.
	err := im.tx.QueryRow(ctx, `
		INSERT INTO people AS p (name) VALUES ($1)
		ON CONFLICT (normalized_name) DO UPDATE SET name = p.name
		RETURNING p.id`, name).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("upsert person %q: %w", name, err)
	}
	im.people[key] = id
	return id, nil
}

// genre resolves a genre name to an id, keyed by the slug the target derives
// from it. An existing genre keeps its stored name — the import adds
// associations, it does not rename what is already curated.
func (im *importer) genre(ctx context.Context, name string) (uuid.UUID, error) {
	slug := slugFor(name)
	if id, ok := im.genres[slug]; ok {
		return id, nil
	}

	var id uuid.UUID
	err := im.tx.QueryRow(ctx, `
		INSERT INTO genres AS g (name, slug) VALUES ($1, $2)
		ON CONFLICT (slug) DO UPDATE SET name = g.name
		RETURNING g.id`, name, slug).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("upsert genre %q: %w", name, err)
	}
	im.genres[slug] = id
	return id, nil
}

// loadFingerprints reads the target catalog so already-imported songs can be
// recognized. Names come back raw and are folded in Go, so both sides of the
// comparison go through the identical function.
func loadFingerprints(ctx context.Context, tx pgx.Tx) (map[string]struct{}, error) {
	rows, err := tx.Query(ctx, `
		SELECT s.title,
		       coalesce(array_agg(p.name) FILTER (WHERE p.name IS NOT NULL), '{}')
		FROM songs s
		LEFT JOIN song_credits sc ON sc.song_id = s.id
		LEFT JOIN people p        ON p.id = sc.person_id
		GROUP BY s.id, s.title`)
	if err != nil {
		return nil, fmt.Errorf("read existing songs: %w", err)
	}
	defer rows.Close()

	out := make(map[string]struct{})
	for rows.Next() {
		var title string
		var names []string
		if err := rows.Scan(&title, &names); err != nil {
			return nil, fmt.Errorf("scan existing song: %w", err)
		}
		out[fingerprint(title, names)] = struct{}{}
	}
	return out, rows.Err()
}

// resolveActor maps an email onto the user recorded as created_by/updated_by.
// An unknown address is an error rather than a silent fallback to NULL: it
// almost always means a typo, and the attribution would be quietly lost.
func resolveActor(ctx context.Context, tx pgx.Tx, email string) (*uuid.UUID, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return nil, nil
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("no user with email %q; sign in once to create the account, or omit -actor-email", email)
	}
	if err != nil {
		return nil, fmt.Errorf("look up actor: %w", err)
	}
	return &id, nil
}

// warnings accumulates non-fatal adjustments, collapsing identical messages
// into one line with a count. A systematic problem — every song missing a
// language, say — should read as one finding with its scale, not 967 lines.
type warnings struct {
	counts map[string]int
	order  []string
}

func newWarnings() *warnings { return &warnings{counts: map[string]int{}} }

func (w *warnings) add(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if _, seen := w.counts[msg]; !seen {
		w.order = append(w.order, msg)
	}
	w.counts[msg]++
}

// report writes the accumulated warnings, most frequent first.
func (w *warnings) report(out io.Writer) {
	if len(w.order) == 0 {
		return
	}
	msgs := append([]string(nil), w.order...)
	sort.SliceStable(msgs, func(i, j int) bool { return w.counts[msgs[i]] > w.counts[msgs[j]] })

	// Writes to a diagnostic stream: if the report itself cannot be written
	// there is nowhere left to report that fact.
	_, _ = fmt.Fprintf(out, "%d distinct warning(s):\n", len(msgs))
	for _, m := range msgs {
		if n := w.counts[m]; n > 1 {
			_, _ = fmt.Fprintf(out, "  [x%d] %s\n", n, m)
		} else {
			_, _ = fmt.Fprintf(out, "  %s\n", m)
		}
	}
}

func orUnknown(s string) string {
	if strings.TrimSpace(s) == "" {
		return "(unknown)"
	}
	return s
}
