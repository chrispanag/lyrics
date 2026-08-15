package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SongSort selects the ordering of a song listing.
type SongSort string

const (
	SortRelevance SongSort = "relevance"
	SortTitle     SongSort = "title"
	SortNewest    SongSort = "newest"
	SortOldest    SongSort = "oldest"
)

// SongFilter describes a song listing request. A zero value lists everything,
// newest first.
type SongFilter struct {
	Query      string
	PersonID   *uuid.UUID // credited in any capacity
	ArtistID   *uuid.UUID
	ComposerID *uuid.UUID
	LyricistID *uuid.UUID
	GenreID    *uuid.UUID
	GenreSlug  string
	Language   string
	YearFrom   *int
	YearTo     *int
	CreatedBy  *uuid.UUID
	Sort       SongSort
	Limit      int
	Offset     int
}

// songColumns is the projection shared by every song read.
const songColumns = `s.id, s.title, s.alt_title, s.lyrics, s.language, s.youtube_url,
	s.youtube_video_id, s.release_year, s.notes, s.created_by, s.updated_by,
	s.created_at, s.updated_at`

// songScanDest returns scan targets in songColumns order. Both the single-row
// and the multi-row read go through it, so the projection and its destinations
// cannot drift apart — a mismatch there does not fail to compile, it silently
// lands values in the wrong fields wherever two columns share a type.
func songScanDest(s *Song) []any {
	return []any{&s.ID, &s.Title, &s.AltTitle, &s.Lyrics, &s.Language, &s.YouTubeURL,
		&s.YouTubeVideoID, &s.ReleaseYear, &s.Notes, &s.CreatedBy, &s.UpdatedBy,
		&s.CreatedAt, &s.UpdatedAt}
}

// scanSong reads the songColumns projection in order.
func scanSong(row pgx.Row, s *Song) error {
	return row.Scan(songScanDest(s)...)
}

// buildSongFilters renders the filter clauses common to listing, searching, and
// counting. Each credit filter is an EXISTS subquery rather than a join: joining
// song_credits would multiply a song by its number of matching credits, and two
// credit filters would then intersect incorrectly.
func buildSongFilters(f SongFilter, a *args) []string {
	var conds []string

	creditFilter := func(id *uuid.UUID, role CreditRole) {
		if id == nil {
			return
		}
		if role == "" {
			conds = append(conds, fmt.Sprintf(
				`EXISTS (SELECT 1 FROM song_credits sc WHERE sc.song_id = s.id AND sc.person_id = %s)`,
				a.next(*id)))
			return
		}
		conds = append(conds, fmt.Sprintf(
			`EXISTS (SELECT 1 FROM song_credits sc WHERE sc.song_id = s.id AND sc.person_id = %s AND sc.role = %s)`,
			a.next(*id), a.next(string(role))))
	}

	creditFilter(f.PersonID, "")
	creditFilter(f.ArtistID, CreditArtist)
	creditFilter(f.ComposerID, CreditComposer)
	creditFilter(f.LyricistID, CreditLyricist)

	switch {
	case f.GenreID != nil:
		conds = append(conds, fmt.Sprintf(
			`EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id AND sg.genre_id = %s)`,
			a.next(*f.GenreID)))
	case f.GenreSlug != "":
		conds = append(conds, fmt.Sprintf(
			`EXISTS (SELECT 1 FROM song_genres sg JOIN genres g ON g.id = sg.genre_id
			         WHERE sg.song_id = s.id AND g.slug = %s)`,
			a.next(f.GenreSlug)))
	}

	if f.Language != "" {
		conds = append(conds, "s.language = "+a.next(f.Language))
	}
	if f.YearFrom != nil {
		conds = append(conds, "s.release_year >= "+a.next(*f.YearFrom))
	}
	if f.YearTo != nil {
		conds = append(conds, "s.release_year <= "+a.next(*f.YearTo))
	}
	if f.CreatedBy != nil {
		conds = append(conds, "s.created_by = "+a.next(*f.CreatedBy))
	}
	return conds
}

// matchClause renders the relevance predicate: an exact full-text hit, or a
// trigram-similar title or credit. The trigram arms use the `%` operator (not
// `similarity() >= x`) because only `%` can be answered from the GIN trigram
// indexes; its threshold is set per connection in New.
//
// It returns the placeholders it allocated so the caller can reuse the same
// parameters for scoring and snippet generation instead of assuming positions.
func matchClause(a *args, query string) (clause, tsqParam, rawParam string) {
	tsqParam = a.next(BuildTSQuery(query))
	rawParam = a.next(query)
	// `<%` reads as "the left operand is word-similar to some run of words in
	// the right operand", and the right operand is what the GIN trigram indexes
	// cover — so the query goes on the left.
	clause = fmt.Sprintf(`(
		s.search_vector @@ to_tsquery('public.app_simple', %[1]s)
		OR app_norm(%[2]s) <%% app_norm(s.title)
		OR app_norm(%[2]s) <%% app_norm(s.credits_text)
	)`, tsqParam, rawParam)
	return clause, tsqParam, rawParam
}

// Valid reports whether the sort is one this package implements. An empty sort
// is valid and means "the default for this mode".
func (s SongSort) Valid() bool {
	switch s {
	case "", SortRelevance, SortTitle, SortNewest, SortOldest:
		return true
	default:
		return false
	}
}

func orderClause(sort SongSort) string {
	switch sort {
	case SortTitle:
		return "app_norm(s.title) ASC, s.id ASC"
	case SortOldest:
		return "s.created_at ASC, s.id ASC"
	default:
		return "s.created_at DESC, s.id ASC"
	}
}

// searchOrderClause is orderClause's counterpart for relevance mode, expressed
// over the columns the `scored`/`hits` CTEs carry rather than over `songs`.
//
// Without it an explicit sort was accepted and then silently discarded whenever
// a query was present: the UI offers Title and Newest alongside a search box,
// and picking one changed nothing. The prefix lets the same ordering be written
// twice — once inside the CTE that applies LIMIT, once on the join that reads
// it back — which must agree or the page is ordered differently from the way it
// was selected.
func searchOrderClause(sort SongSort, prefix string) string {
	col := func(name string) string { return prefix + name }
	switch sort {
	case SortTitle:
		return col("sort_title") + " ASC, " + col("id") + " ASC"
	case SortNewest:
		return col("created_at") + " DESC, " + col("id") + " ASC"
	case SortOldest:
		return col("created_at") + " ASC, " + col("id") + " ASC"
	default:
		return col("score") + " DESC, " + col("sort_title") + " ASC, " + col("id") + " ASC"
	}
}

// ListSongs returns a page of songs plus the total matching count.
//
// A non-empty Query switches to relevance mode, which additionally computes a
// blended score and a highlighted lyrics snippet.
func (s *Store) ListSongs(ctx context.Context, f SongFilter) ([]Song, int, error) {
	f.Limit = clampLimit(f.Limit)
	if strings.TrimSpace(f.Query) != "" {
		return s.searchSongs(ctx, f)
	}
	return s.browseSongs(ctx, f)
}

// browseSongs handles the no-query case: plain filtering and ordering.
func (s *Store) browseSongs(ctx context.Context, f SongFilter) ([]Song, int, error) {
	a := &args{}
	conds := buildSongFilters(f, a)
	where := "TRUE"
	if len(conds) > 0 {
		where = strings.Join(conds, " AND ")
	}

	total, err := s.countSongs(ctx, where, a.values)
	if err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return nil, 0, nil
	}

	query := fmt.Sprintf(`
		SELECT %s
		FROM songs s
		WHERE %s
		ORDER BY %s
		LIMIT %s OFFSET %s`,
		songColumns, where, orderClause(f.Sort), a.next(f.Limit), a.next(f.Offset))

	songs, err := s.collectSongs(ctx, query, a.values, false)
	if err != nil {
		return nil, 0, err
	}
	return songs, total, nil
}

// searchSongs handles the relevance case.
//
// The pipeline is deliberately three stages: score and filter, then rank and
// paginate, and only then generate snippets. ts_headline re-parses the full
// lyrics body of every row it touches, so computing it before the LIMIT would
// pay that cost for the entire result set instead of a single page.
func (s *Store) searchSongs(ctx context.Context, f SongFilter) ([]Song, int, error) {
	a := &args{}
	match, tsqParam, rawParam := matchClause(a, f.Query)
	conds := append([]string{match}, buildSongFilters(f, a)...)
	where := strings.Join(conds, " AND ")

	total, err := s.countSongs(ctx, where, a.values)
	if err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return nil, 0, nil
	}

	query := fmt.Sprintf(`
		WITH scored AS (
			SELECT s.id,
			       ts_rank_cd(%[1]s, s.search_vector,
			                  to_tsquery('public.app_simple', %[2]s), 32) AS text_rank,
			       GREATEST(
			           word_similarity(app_norm(%[3]s), app_norm(s.title)),
			           word_similarity(app_norm(%[3]s), app_norm(s.credits_text))
			       ) AS trgm_score,
			       app_norm(s.title) AS sort_title,
			       s.created_at
			FROM songs s
			WHERE %[4]s
		),
		hits AS (
			SELECT id, sort_title, created_at,
			       (%[5]v * text_rank + %[6]v * trgm_score) AS score
			FROM scored
			ORDER BY %[7]s
			LIMIT %[8]s OFFSET %[9]s
		)
		SELECT %[10]s, h.score,
		       ts_headline('public.app_simple', s.lyrics,
		                   to_tsquery('public.app_simple', %[2]s), %[11]s)
		FROM hits h
		JOIN songs s ON s.id = h.id
		ORDER BY %[12]s`,
		weightArray, tsqParam, rawParam, where,
		textRankWeight, trgmWeight,
		searchOrderClause(f.Sort, ""),
		a.next(f.Limit), a.next(f.Offset), songColumns, a.next(headlineOptions),
		searchOrderClause(f.Sort, "h."))

	songs, err := s.collectSongs(ctx, query, a.values, true)
	if err != nil {
		return nil, 0, err
	}
	return songs, total, nil
}

func (s *Store) countSongs(ctx context.Context, where string, values []any) (int, error) {
	return s.count(ctx, "count songs", "SELECT count(*) FROM songs s WHERE "+where, values...)
}

// collectSongs runs a song query and attaches credits and genres to the result.
func (s *Store) collectSongs(ctx context.Context, query string, values []any, withRelevance bool) ([]Song, error) {
	rows, err := s.pool.Query(ctx, query, values...)
	if err != nil {
		return nil, fmt.Errorf("query songs: %w", translateErr(err))
	}
	defer rows.Close()

	var songs []Song
	for rows.Next() {
		var song Song
		var score *float64
		var snippet *string

		dest := songScanDest(&song)
		if withRelevance {
			dest = append(dest, &score, &snippet)
		}

		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("scan song: %w", err)
		}
		song.Score, song.Snippet = score, snippet
		songs = append(songs, song)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate songs: %w", err)
	}

	if err := s.attachRelations(ctx, songs); err != nil {
		return nil, err
	}
	return songs, nil
}

// attachRelations loads credits and genres for a page of songs in two queries.
// Fetching them as part of the main query would multiply each song by its
// credit count, which breaks LIMIT.
func (s *Store) attachRelations(ctx context.Context, songs []Song) error {
	if len(songs) == 0 {
		return nil
	}

	ids := make([]uuid.UUID, len(songs))
	index := make(map[uuid.UUID]*Song, len(songs))
	for i := range songs {
		ids[i] = songs[i].ID
		index[songs[i].ID] = &songs[i]
	}

	creditRows, err := s.pool.Query(ctx, `
		SELECT sc.song_id, sc.person_id, p.name, sc.role, sc.position
		FROM song_credits sc
		JOIN people p ON p.id = sc.person_id
		WHERE sc.song_id = ANY($1)
		ORDER BY sc.role, sc.position, p.name`, ids)
	if err != nil {
		return fmt.Errorf("query credits: %w", translateErr(err))
	}
	defer creditRows.Close()

	for creditRows.Next() {
		var songID uuid.UUID
		var c Credit
		if err := creditRows.Scan(&songID, &c.PersonID, &c.Name, &c.Role, &c.Position); err != nil {
			return fmt.Errorf("scan credit: %w", err)
		}
		if song := index[songID]; song != nil {
			song.Credits = append(song.Credits, c)
		}
	}
	if err := creditRows.Err(); err != nil {
		return fmt.Errorf("iterate credits: %w", err)
	}
	creditRows.Close()

	genreRows, err := s.pool.Query(ctx, `
		SELECT sg.song_id, g.id, g.name, g.slug
		FROM song_genres sg
		JOIN genres g ON g.id = sg.genre_id
		WHERE sg.song_id = ANY($1)
		ORDER BY g.name`, ids)
	if err != nil {
		return fmt.Errorf("query genres: %w", translateErr(err))
	}
	defer genreRows.Close()

	for genreRows.Next() {
		var songID uuid.UUID
		var g Genre
		if err := genreRows.Scan(&songID, &g.ID, &g.Name, &g.Slug); err != nil {
			return fmt.Errorf("scan genre: %w", err)
		}
		if song := index[songID]; song != nil {
			song.Genres = append(song.Genres, g)
		}
	}
	if err := genreRows.Err(); err != nil {
		return fmt.Errorf("iterate genres: %w", err)
	}

	// Normalize nil slices so the JSON encoder emits [] rather than null.
	for i := range songs {
		if songs[i].Credits == nil {
			songs[i].Credits = []Credit{}
		}
		if songs[i].Genres == nil {
			songs[i].Genres = []Genre{}
		}
	}
	return nil
}

// GetSong loads a single song with its credits and genres.
func (s *Store) GetSong(ctx context.Context, id uuid.UUID) (*Song, error) {
	var song Song
	query := "SELECT " + songColumns + " FROM songs s WHERE s.id = $1"
	if err := scanSong(s.pool.QueryRow(ctx, query, id), &song); err != nil {
		return nil, translateErr(err)
	}

	songs := []Song{song}
	if err := s.attachRelations(ctx, songs); err != nil {
		return nil, err
	}
	return &songs[0], nil
}

// actorRef maps a zero actor onto NULL. created_by/updated_by are nullable
// because catalog content outlives the account that entered it — a seeded or
// imported song legitimately has no author.
func actorRef(actor uuid.UUID) *uuid.UUID {
	if actor == uuid.Nil {
		return nil
	}
	return &actor
}

// SongInput is the writable shape of a song.
type SongInput struct {
	Title          string
	AltTitle       *string
	Lyrics         string
	Language       string
	YouTubeURL     *string
	YouTubeVideoID *string
	ReleaseYear    *int
	Notes          *string
	Credits        []Credit
	GenreIDs       []uuid.UUID
}

// CreateSong inserts a song together with its credits and genres, atomically.
func (s *Store) CreateSong(ctx context.Context, in SongInput, actor uuid.UUID) (*Song, error) {
	var id uuid.UUID

	err := s.inTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO songs (title, alt_title, lyrics, language, youtube_url,
			                   youtube_video_id, release_year, notes, created_by, updated_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
			RETURNING id`,
			in.Title, in.AltTitle, in.Lyrics, in.Language, in.YouTubeURL,
			in.YouTubeVideoID, in.ReleaseYear, in.Notes, actorRef(actor)).Scan(&id)
		if err != nil {
			return fmt.Errorf("insert song: %w", translateErr(err))
		}
		return replaceRelations(ctx, tx, id, in.Credits, in.GenreIDs)
	})
	if err != nil {
		return nil, err
	}
	return s.GetSong(ctx, id)
}

// UpdateSong replaces a song's fields, credits, and genres.
func (s *Store) UpdateSong(ctx context.Context, id uuid.UUID, in SongInput, actor uuid.UUID) (*Song, error) {
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE songs SET title = $2, alt_title = $3, lyrics = $4, language = $5,
			                 youtube_url = $6, youtube_video_id = $7, release_year = $8,
			                 notes = $9, updated_by = $10
			WHERE id = $1`,
			id, in.Title, in.AltTitle, in.Lyrics, in.Language, in.YouTubeURL,
			in.YouTubeVideoID, in.ReleaseYear, in.Notes, actorRef(actor))
		if err != nil {
			return fmt.Errorf("update song: %w", translateErr(err))
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return replaceRelations(ctx, tx, id, in.Credits, in.GenreIDs)
	})
	if err != nil {
		return nil, err
	}
	return s.GetSong(ctx, id)
}

// replaceRelations rewrites a song's credits and genres wholesale. Delete-then-
// insert keeps the caller's payload authoritative and lets the denormalization
// triggers fire once per affected row.
func replaceRelations(ctx context.Context, tx pgx.Tx, songID uuid.UUID, credits []Credit, genreIDs []uuid.UUID) error {
	if _, err := tx.Exec(ctx, `DELETE FROM song_credits WHERE song_id = $1`, songID); err != nil {
		return fmt.Errorf("clear credits: %w", translateErr(err))
	}
	for _, c := range credits {
		_, err := tx.Exec(ctx, `
			INSERT INTO song_credits (song_id, person_id, role, position)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (song_id, person_id, role) DO UPDATE SET position = EXCLUDED.position`,
			songID, c.PersonID, c.Role, c.Position)
		if err != nil {
			return fmt.Errorf("insert credit: %w", translateErr(err))
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM song_genres WHERE song_id = $1`, songID); err != nil {
		return fmt.Errorf("clear genres: %w", translateErr(err))
	}
	for _, gid := range genreIDs {
		_, err := tx.Exec(ctx, `
			INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2)
			ON CONFLICT DO NOTHING`, songID, gid)
		if err != nil {
			return fmt.Errorf("insert genre: %w", translateErr(err))
		}
	}
	return nil
}

// DeleteSong removes a song. Credits, genre links, and list entries cascade.
func (s *Store) DeleteSong(ctx context.Context, id uuid.UUID) error {
	return s.execExpectingRow(ctx, "delete song", `DELETE FROM songs WHERE id = $1`, id)
}
