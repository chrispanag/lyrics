package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// AnonymousClickActor is the dedupe key for an opening by someone signed out.
// The visitor id is minted by the browser and is not an account.
func AnonymousClickActor(visitor uuid.UUID) string {
	return "anon:" + visitor.String()
}

// UserClickActor is the dedupe key for an opening by a signed-in account.
func UserClickActor(userID uuid.UUID) string {
	return "user:" + userID.String()
}

// RecordSongClick counts one opening of a song. A repeat by the same actor
// inside the visit window (30 minutes, in record_song_click) does not count
// again. counted is false in that case. ErrNotFound when no song has the id.
//
// The split, the save tallies, and the score all live in song_popularity and
// are maintained in SQL. This does not write them.
func (s *Store) RecordSongClick(ctx context.Context, songID uuid.UUID, actorKey string, authenticated bool) (bool, error) {
	if actorKey == "" {
		return false, fmt.Errorf("%w: a click needs an actor", ErrInvalid)
	}

	// NULL is "no such song", distinct from false ("already counted").
	var counted *bool
	err := s.pool.QueryRow(ctx,
		`SELECT record_song_click($1, $2, $3)`, songID, actorKey, authenticated).Scan(&counted)
	if err != nil {
		return false, fmt.Errorf("record song click: %w", translateErr(err))
	}
	if counted == nil {
		return false, ErrNotFound
	}
	return *counted, nil
}

// SongPopularity reads the tally for one song. A song that has never been
// opened or saved has no row and reads as zeros. ErrNotFound when the song
// itself does not exist, so a caller cannot mistake a missing song for a
// song nobody has touched.
func (s *Store) SongPopularity(ctx context.Context, songID uuid.UUID) (SongPopularity, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM songs WHERE id = $1)`, songID).Scan(&exists); err != nil {
		return SongPopularity{}, fmt.Errorf("check song: %w", translateErr(err))
	}
	if !exists {
		return SongPopularity{}, ErrNotFound
	}

	var p SongPopularity
	err := s.pool.QueryRow(ctx, `
		SELECT anon_clicks, user_clicks, list_adds, list_users, score
		FROM song_popularity
		WHERE song_id = $1`, songID).Scan(
		&p.AnonymousClicks, &p.AuthenticatedClicks, &p.ListAdds, &p.ListUsers, &p.Score)
	if err != nil {
		if IsNotFound(translateErr(err)) {
			return SongPopularity{}, nil
		}
		return SongPopularity{}, fmt.Errorf("read song popularity: %w", translateErr(err))
	}
	return p, nil
}

// attachPopularity fills Popularity for a page of songs. A song with no row
// yet keeps the zero value, which is the same tally the table would hold.
func (s *Store) attachPopularity(ctx context.Context, ids []uuid.UUID, index map[uuid.UUID]*Song) error {
	rows, err := s.pool.Query(ctx, `
		SELECT song_id, anon_clicks, user_clicks, list_adds, list_users, score
		FROM song_popularity
		WHERE song_id = ANY($1)`, ids)
	if err != nil {
		return fmt.Errorf("query song popularity: %w", translateErr(err))
	}
	defer rows.Close()

	for rows.Next() {
		var songID uuid.UUID
		var p SongPopularity
		if err := rows.Scan(&songID, &p.AnonymousClicks, &p.AuthenticatedClicks,
			&p.ListAdds, &p.ListUsers, &p.Score); err != nil {
			return fmt.Errorf("scan song popularity: %w", err)
		}
		if song := index[songID]; song != nil {
			song.Popularity = p
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate song popularity: %w", err)
	}
	return nil
}
