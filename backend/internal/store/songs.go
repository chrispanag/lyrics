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
	Query string
	// PersonID matches anyone credited on the work or performing on one of its
	// recordings. Song pages link every name to it, so both tables are asked.
	PersonID *uuid.UUID
	// PerformerID matches someone who performed one of the recordings.
	PerformerID *uuid.UUID
	ComposerID  *uuid.UUID
	LyricistID  *uuid.UUID
	GenreID     *uuid.UUID
	GenreSlug   string
	Language    string
	YearFrom    *int
	YearTo      *int
	CreatedBy   *uuid.UUID
	Sort        SongSort
	Limit       int
	Offset      int
}

// songSummaryColumns is the projection every song read starts from: everything
// but the body, which no listing renders.
const songSummaryColumns = `s.id, s.title, s.slug, s.alt_title, s.language, s.youtube_url,
	s.youtube_video_id, s.release_year, s.notes, s.created_by, s.updated_by,
	s.created_at, s.updated_at`

// songColumns is the full read: the summary with the body appended, mirroring
// how songScanDest extends songSummaryScanDest.
const songColumns = songSummaryColumns + `, s.lyrics`

// songSummaryScanDest returns scan targets in songSummaryColumns order, and
// songScanDest appends the body as the projection does. A mismatch compiles and
// silently lands values in the wrong fields.
func songSummaryScanDest(s *Song) []any {
	return []any{&s.ID, &s.Title, &s.Slug, &s.AltTitle, &s.Language, &s.YouTubeURL,
		&s.YouTubeVideoID, &s.ReleaseYear, &s.Notes, &s.CreatedBy, &s.UpdatedBy,
		&s.CreatedAt, &s.UpdatedAt}
}

func songScanDest(s *Song) []any {
	return append(songSummaryScanDest(s), &s.Lyrics)
}

// scanSong reads the songColumns projection in order.
func scanSong(row pgx.Row, s *Song) error {
	return row.Scan(songScanDest(s)...)
}

// buildSongFilters renders the WHERE clauses shared by list, search and count.
// Credit filters are EXISTS, not joins: a join multiplies rows and breaks AND.
func buildSongFilters(f SongFilter, a *args) []string {
	var conds []string

	creditFilter := func(id *uuid.UUID, role CreditRole) {
		if id == nil {
			return
		}
		conds = append(conds, fmt.Sprintf(
			`EXISTS (SELECT 1 FROM song_credits sc WHERE sc.song_id = s.id AND sc.person_id = %s AND sc.role = %s)`,
			a.next(*id), a.next(string(role))))
	}

	// The two places a person can be attached to a song, one spelling each, so
	// ?person= and ?performer= cannot drift apart. They take a placeholder
	// because ?person= references one twice. A join inside EXISTS cannot
	// multiply the outer rows.
	creditedOn := func(ph string) string {
		return fmt.Sprintf(
			`EXISTS (SELECT 1 FROM song_credits sc WHERE sc.song_id = s.id AND sc.person_id = %s)`,
			ph)
	}
	performedBy := func(ph string) string {
		return fmt.Sprintf(
			`EXISTS (SELECT 1 FROM recordings r
			         JOIN recording_credits rc ON rc.recording_id = r.id
			         WHERE r.song_id = s.id AND rc.person_id = %s)`,
			ph)
	}

	if f.PersonID != nil {
		// One placeholder, referenced by both arms.
		p := a.next(*f.PersonID)
		conds = append(conds, "("+creditedOn(p)+" OR "+performedBy(p)+")")
	}
	if f.PerformerID != nil {
		conds = append(conds, performedBy(a.next(*f.PerformerID)))
	}
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
// word-similar title or credit. The `<%` operator, not `word_similarity() >= x`,
// because only the operator uses the GIN trigram indexes; its threshold is set
// per connection in New. It returns its placeholders for scoring and snippets.
func matchClause(a *args, query string) (clause, tsqParam, rawParam string) {
	tsqParam = a.next(BuildTSQuery(query))
	rawParam = a.next(query)
	// The query goes on the left of `<%`; the indexed column on the right.
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

// searchOrderClause is orderClause for relevance mode, over the `scored`/`hits`
// CTE columns. The prefix lets one ordering be written in the CTE that applies
// LIMIT and on the outer join; the two must agree.
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
		songSummaryColumns, where, orderClause(f.Sort), a.next(f.Limit), a.next(f.Offset))

	songs, err := s.collectSongs(ctx, query, a.values, false)
	if err != nil {
		return nil, 0, err
	}
	return songs, total, nil
}

// searchSongs handles the relevance case: score and filter, rank and paginate,
// then snippets. ts_headline re-parses each body, so it runs after the LIMIT.
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
		a.next(f.Limit), a.next(f.Offset), songSummaryColumns, a.next(headlineOptions),
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

// collectSongs runs a summary-projection song query and attaches relations.
// Lyrics stay nil (not loaded), not blank.
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

		dest := songSummaryScanDest(&song)
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

// attachRelations loads credits, genres and recordings for a page of songs, in
// separate queries so joins cannot multiply rows past LIMIT. Every song read
// goes through here.
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
	genreRows.Close()

	if err := s.attachRecordings(ctx, songs, ids, index); err != nil {
		return err
	}

	// Normalize nil slices so JSON emits [] rather than null. attachRecordings
	// normalizes its own.
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

// attachRecordings loads each song's recordings and their performers, as two
// queries so a recording is not repeated per performer.
func (s *Store) attachRecordings(
	ctx context.Context,
	songs []Song,
	ids []uuid.UUID,
	index map[uuid.UUID]*Song,
) error {
	// Nil slices become [] for JSON. Deferred to cover both success returns.
	defer func() {
		for i := range songs {
			if songs[i].Recordings == nil {
				songs[i].Recordings = []Recording{}
			}
			for j := range songs[i].Recordings {
				if songs[i].Recordings[j].Performers == nil {
					songs[i].Recordings[j].Performers = []RecordingPerformer{}
				}
			}
		}
	}()

	// This ORDER BY defines "first recording": index 0 is it. `id` breaks the
	// remaining ties. Mirrored in refresh_songs_denorm (migration 000009);
	// TestFirstRecordingRuleHasOneAuthority pins the two together.
	recordingRows, err := s.pool.Query(ctx, `
		SELECT r.song_id, r.id, r.label, r.youtube_url, r.youtube_video_id,
		       r.release_year, r.notes, r.is_first, r.position
		FROM recordings r
		WHERE r.song_id = ANY($1)
		ORDER BY r.is_first DESC, r.release_year ASC NULLS LAST, r.position ASC, r.id`, ids)
	if err != nil {
		return fmt.Errorf("query recordings: %w", translateErr(err))
	}
	defer recordingRows.Close()

	var recordingIDs []uuid.UUID
	for recordingRows.Next() {
		var songID uuid.UUID
		var r Recording
		if err := recordingRows.Scan(&songID, &r.ID, &r.Label, &r.YouTubeURL,
			&r.YouTubeVideoID, &r.ReleaseYear, &r.Notes, &r.IsFirst, &r.Position); err != nil {
			return fmt.Errorf("scan recording: %w", err)
		}
		if song := index[songID]; song != nil {
			song.Recordings = append(song.Recordings, r)
			recordingIDs = append(recordingIDs, r.ID)
		}
	}
	if err := recordingRows.Err(); err != nil {
		return fmt.Errorf("iterate recordings: %w", err)
	}
	recordingRows.Close()

	if len(recordingIDs) == 0 {
		return nil
	}

	// Indexed only after every append: pointers taken earlier could point into
	// a reallocated slice, silently losing the performers.
	byRecording := make(map[uuid.UUID]*Recording, len(recordingIDs))
	for i := range songs {
		for j := range songs[i].Recordings {
			byRecording[songs[i].Recordings[j].ID] = &songs[i].Recordings[j]
		}
	}

	performerRows, err := s.pool.Query(ctx, `
		SELECT rc.recording_id, rc.person_id, p.name, rc.position
		FROM recording_credits rc
		JOIN people p ON p.id = rc.person_id
		WHERE rc.recording_id = ANY($1)
		ORDER BY rc.position, p.name`, recordingIDs)
	if err != nil {
		return fmt.Errorf("query performers: %w", translateErr(err))
	}
	defer performerRows.Close()

	for performerRows.Next() {
		var recordingID uuid.UUID
		var p RecordingPerformer
		if err := performerRows.Scan(&recordingID, &p.PersonID, &p.Name, &p.Position); err != nil {
			return fmt.Errorf("scan performer: %w", err)
		}
		if recording := byRecording[recordingID]; recording != nil {
			recording.Performers = append(recording.Performers, p)
		}
	}
	if err := performerRows.Err(); err != nil {
		return fmt.Errorf("iterate performers: %w", err)
	}
	return nil
}

// GetSong loads a single song with its credits, genres and recordings.
func (s *Store) GetSong(ctx context.Context, id uuid.UUID) (*Song, error) {
	return s.getSongWhere(ctx, "s.id = $1", id)
}

// GetSongBySlug is GetSong by the song's address. Separate so the handler
// decides which form a path segment is before asking.
func (s *Store) GetSongBySlug(ctx context.Context, slug string) (*Song, error) {
	return s.getSongWhere(ctx, "s.slug = $1", slug)
}

// SongIDBySlug resolves an address to the song's id only, for callers that do
// not need the row or its relations.
func (s *Store) SongIDBySlug(ctx context.Context, slug string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT id FROM songs WHERE slug = $1`, slug).Scan(&id)
	if err != nil {
		return uuid.Nil, translateErr(err)
	}
	return id, nil
}

func (s *Store) getSongWhere(ctx context.Context, where string, arg any) (*Song, error) {
	var song Song
	query := "SELECT " + songColumns + " FROM songs s WHERE " + where
	if err := scanSong(s.pool.QueryRow(ctx, query, arg), &song); err != nil {
		return nil, translateErr(err)
	}

	songs := []Song{song}
	if err := s.attachRelations(ctx, songs); err != nil {
		return nil, err
	}
	return &songs[0], nil
}

// actorRef maps a zero actor onto NULL; seeded and imported songs have no
// author.
func actorRef(actor uuid.UUID) *uuid.UUID {
	if actor == uuid.Nil {
		return nil
	}
	return &actor
}

// SongInput is the writable shape of a song. No YouTube link or release year:
// the song's copies are trigger-written and must have no second writer.
type SongInput struct {
	Title      string
	AltTitle   *string
	Lyrics     string
	Language   string
	Notes      *string
	Credits    []Credit
	GenreIDs   []uuid.UUID
	Recordings []RecordingInput
}

// RecordingInput is the writable shape of one recording. Unvalidated: the URL
// and id may disagree (the importer keeps unparseable links); the API layer
// canonicalizes.
type RecordingInput struct {
	Label          *string
	YouTubeURL     *string
	YouTubeVideoID *string
	ReleaseYear    *int
	Notes          *string
	IsFirst        bool
	Position       int
	// Performers name people by id; Name is ignored.
	Performers []RecordingPerformer
}

// CreateSong inserts a song together with its relations, atomically.
func (s *Store) CreateSong(ctx context.Context, in SongInput, actor uuid.UUID) (*Song, error) {
	var id uuid.UUID

	err := s.inTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO songs (title, alt_title, lyrics, language, notes,
			                   created_by, updated_by)
			VALUES ($1, $2, $3, $4, $5, $6, $6)
			RETURNING id`,
			in.Title, in.AltTitle, in.Lyrics, in.Language, in.Notes,
			actorRef(actor)).Scan(&id)
		if err != nil {
			return fmt.Errorf("insert song: %w", translateErr(err))
		}
		return replaceRelations(ctx, tx, id, in)
	})
	if err != nil {
		return nil, err
	}
	return s.GetSong(ctx, id)
}

// UpdateSong replaces a song's fields and relations.
func (s *Store) UpdateSong(ctx context.Context, id uuid.UUID, in SongInput, actor uuid.UUID) (*Song, error) {
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE songs SET title = $2, alt_title = $3, lyrics = $4, language = $5,
			                 notes = $6, updated_by = $7
			WHERE id = $1`,
			id, in.Title, in.AltTitle, in.Lyrics, in.Language, in.Notes, actorRef(actor))
		if err != nil {
			return fmt.Errorf("update song: %w", translateErr(err))
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return replaceRelations(ctx, tx, id, in)
	})
	if err != nil {
		return nil, err
	}
	return s.GetSong(ctx, id)
}

// replaceRelations rewrites a song's credits, genres and recordings wholesale,
// so recording ids do not survive a write.
func replaceRelations(ctx context.Context, tx pgx.Tx, songID uuid.UUID, in SongInput) error {
	if _, err := tx.Exec(ctx, `DELETE FROM song_credits WHERE song_id = $1`, songID); err != nil {
		return fmt.Errorf("clear credits: %w", translateErr(err))
	}
	for _, c := range in.Credits {
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
	for _, gid := range in.GenreIDs {
		_, err := tx.Exec(ctx, `
			INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2)
			ON CONFLICT DO NOTHING`, songID, gid)
		if err != nil {
			return fmt.Errorf("insert genre: %w", translateErr(err))
		}
	}

	// The performers cascade from the recordings, so one delete covers both.
	if _, err := tx.Exec(ctx, `DELETE FROM recordings WHERE song_id = $1`, songID); err != nil {
		return fmt.Errorf("clear recordings: %w", translateErr(err))
	}
	for _, r := range in.Recordings {
		var recordingID uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO recordings (song_id, label, youtube_url, youtube_video_id,
			                        release_year, notes, is_first, position)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id`,
			songID, r.Label, r.YouTubeURL, r.YouTubeVideoID, r.ReleaseYear,
			r.Notes, r.IsFirst, r.Position).Scan(&recordingID)
		if err != nil {
			// A second is_first is a unique violation (conflict); the API refuses
			// it first, this is the backstop.
			return fmt.Errorf("insert recording: %w", translateErr(err))
		}
		for _, p := range r.Performers {
			// ON CONFLICT: a payload may name the same person twice.
			_, err := tx.Exec(ctx, `
				INSERT INTO recording_credits (recording_id, person_id, position)
				VALUES ($1, $2, $3)
				ON CONFLICT (recording_id, person_id) DO UPDATE SET position = EXCLUDED.position`,
				recordingID, p.PersonID, p.Position)
			if err != nil {
				return fmt.Errorf("insert performer: %w", translateErr(err))
			}
		}
	}
	return nil
}

// DeleteSong removes a song. Credits, genre links, and list entries cascade.
func (s *Store) DeleteSong(ctx context.Context, id uuid.UUID) error {
	return s.execExpectingRow(ctx, "delete song", `DELETE FROM songs WHERE id = $1`, id)
}
