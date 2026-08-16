package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const listColumns = `l.id, l.owner_id, l.name, l.description, l.is_public, l.is_default,
	l.created_at, l.updated_at,
	(SELECT count(*) FROM list_items li WHERE li.list_id = l.id)`

func scanList(row pgx.Row, l *List) error {
	return row.Scan(&l.ID, &l.OwnerID, &l.Name, &l.Description, &l.IsPublic, &l.IsDefault,
		&l.CreatedAt, &l.UpdatedAt, &l.ItemCount)
}

// ListsForOwner returns every list belonging to a user, default list first.
func (s *Store) ListsForOwner(ctx context.Context, ownerID uuid.UUID) ([]List, error) {
	return queryAll(ctx, s, "lists", `
		SELECT `+listColumns+`
		FROM lists l
		WHERE l.owner_id = $1
		ORDER BY l.is_default DESC, l.created_at DESC`, scanList, ownerID)
}

// GetList loads a list without its songs.
func (s *Store) GetList(ctx context.Context, id uuid.UUID) (*List, error) {
	var l List
	if err := scanList(s.pool.QueryRow(ctx, `SELECT `+listColumns+` FROM lists l WHERE l.id = $1`, id), &l); err != nil {
		return nil, translateErr(err)
	}
	return &l, nil
}

// GetListWithSongs loads a list and its songs in curated order.
func (s *Store) GetListWithSongs(ctx context.Context, id uuid.UUID) (*List, error) {
	list, err := s.GetList(ctx, id)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT ` + songColumns + `
		FROM list_items li
		JOIN songs s ON s.id = li.song_id
		WHERE li.list_id = $1
		ORDER BY li.position ASC, li.added_at ASC`

	songs, err := s.collectSongs(ctx, query, []any{id}, false)
	if err != nil {
		return nil, err
	}
	if songs == nil {
		songs = []Song{}
	}
	list.Songs = songs
	return list, nil
}

// CreateList adds a named list for a user.
func (s *Store) CreateList(ctx context.Context, ownerID uuid.UUID, name string, description *string, isPublic bool) (*List, error) {
	name, err := requireName("list", name)
	if err != nil {
		return nil, err
	}

	// `INSERT INTO lists AS l` so RETURNING can use the one listColumns
	// projection verbatim. The alternative — rewriting the constant's `l.`
	// prefix with a string replace — silently corrupts the statement the day a
	// column or alias in the projection happens to contain that substring.
	var l List
	err = scanList(s.pool.QueryRow(ctx, `
		INSERT INTO lists AS l (owner_id, name, description, is_public)
		VALUES ($1, $2, $3, $4)
		RETURNING `+listColumns, ownerID, name, description, isPublic), &l)
	if err != nil {
		return nil, fmt.Errorf("create list: %w", translateErr(err))
	}
	return &l, nil
}

// CopyList duplicates a list, entries included, under a new owner and name.
//
// Whether the source may be read at all is the caller's decision — this copies
// whatever it is given. Visibility is deliberately not carried over: a copy
// starts private, so republishing someone else's list is an explicit act by
// whoever took the copy rather than a side effect of taking it.
func (s *Store) CopyList(ctx context.Context, srcID, ownerID uuid.UUID, name string) (*List, error) {
	name, err := requireName("list", name)
	if err != nil {
		return nil, err
	}

	var l List
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		// Selecting the description from the source rather than passing it in
		// keeps the copy to a single statement, and makes a source deleted
		// between the caller's read and this write insert nothing at all —
		// pgx reports no rows, which translateErr turns into ErrNotFound.
		var newID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO lists (owner_id, name, description, is_public)
			SELECT $1, $2, src.description, false
			FROM lists src
			WHERE src.id = $3
			RETURNING id`, ownerID, name, srcID).Scan(&newID); err != nil {
			return fmt.Errorf("copy list: %w", translateErr(err))
		}

		// Positions are scoped to a list, so copying them verbatim reproduces
		// the curated order without renumbering.
		if _, err := tx.Exec(ctx, `
			INSERT INTO list_items (list_id, song_id, position)
			SELECT $1, song_id, position FROM list_items WHERE list_id = $2`, newID, srcID); err != nil {
			return fmt.Errorf("copy list items: %w", translateErr(err))
		}

		// Re-read instead of RETURNING from the insert above: listColumns counts
		// entries, and at that point the copy still has none.
		return scanList(tx.QueryRow(ctx, `SELECT `+listColumns+` FROM lists l WHERE l.id = $1`, newID), &l)
	})
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// ListUpdate carries the mutable fields of a list. A nil field is left alone.
//
// Description needs the extra SetDescription flag because nil is a meaningful
// value for it — clearing a description — which a lone pointer cannot express.
type ListUpdate struct {
	Name           *string
	Description    *string
	SetDescription bool
	IsPublic       *bool
}

// UpdateList applies a partial update.
func (s *Store) UpdateList(ctx context.Context, id uuid.UUID, u ListUpdate) (*List, error) {
	a := &args{}
	idParam := a.next(id)

	var sets []string
	if u.Name != nil {
		name, err := requireName("list", *u.Name)
		if err != nil {
			return nil, err
		}
		sets = append(sets, "name = "+a.next(name))
	}
	if u.SetDescription {
		sets = append(sets, "description = "+a.next(u.Description))
	}
	if u.IsPublic != nil {
		sets = append(sets, "is_public = "+a.next(*u.IsPublic))
	}
	if len(sets) == 0 {
		return s.GetList(ctx, id)
	}

	query := fmt.Sprintf(`UPDATE lists AS l SET %s WHERE l.id = %s RETURNING %s`,
		strings.Join(sets, ", "), idParam, listColumns)

	var l List
	if err := scanList(s.pool.QueryRow(ctx, query, a.values...), &l); err != nil {
		return nil, translateErr(err)
	}
	return &l, nil
}

// DeleteList removes a list and its entries.
func (s *Store) DeleteList(ctx context.Context, id uuid.UUID) error {
	return s.execExpectingRow(ctx, "delete list", `DELETE FROM lists WHERE id = $1`, id)
}

// AddSongToList appends a song, placing it after the current last entry.
// Re-adding a song already present is a no-op rather than an error, so the
// client can treat "add to list" as idempotent.
func (s *Store) AddSongToList(ctx context.Context, listID, songID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO list_items (list_id, song_id, position)
		VALUES ($1, $2, coalesce((SELECT max(position) + 1 FROM list_items WHERE list_id = $1), 0))
		ON CONFLICT (list_id, song_id) DO NOTHING`, listID, songID)
	if err != nil {
		return fmt.Errorf("add song to list: %w", translateErr(err))
	}
	return nil
}

// RemoveSongFromList drops an entry.
func (s *Store) RemoveSongFromList(ctx context.Context, listID, songID uuid.UUID) error {
	return s.execExpectingRow(ctx, "remove song from list",
		`DELETE FROM list_items WHERE list_id = $1 AND song_id = $2`, listID, songID)
}

// ReorderList rewrites entry positions to match the given song order.
//
// Songs omitted from the payload keep their existing entries and are pushed
// after the ordered ones, so a client working from a stale page cannot silently
// drop songs it did not know about.
//
// The ids must be distinct. They are matched as a set, so a repeated one is
// indistinguishable here from one naming a song the list does not hold, and
// comes back as ErrNotFound — which is why callers reject duplicates before
// they get this far, where the payload can still be described accurately.
// Dragging a song calls this on every drop, so the ordered songs are written by
// one statement rather than one round trip each: a hundred-entry list used to
// mean a hundred sequential updates holding a transaction open.
func (s *Store) ReorderList(ctx context.Context, listID uuid.UUID, songIDs []uuid.UUID) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		// WITH ORDINALITY numbers the array from 1, and positions start at 0.
		tag, err := tx.Exec(ctx, `
			UPDATE list_items li SET position = ordered.pos - 1
			FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(song_id, pos)
			WHERE li.list_id = $1 AND li.song_id = ordered.song_id`, listID, songIDs)
		if err != nil {
			return fmt.Errorf("reorder list: %w", translateErr(err))
		}
		// One row per id, or some id names a song this list does not hold. Which
		// one is no longer singled out, as the per-row loop could; the caller
		// refetches either way, and the status it sees is unchanged.
		if tag.RowsAffected() != int64(len(songIDs)) {
			return fmt.Errorf("%w: %d of %d songs are in this list",
				ErrNotFound, tag.RowsAffected(), len(songIDs))
		}
		// Push anything not mentioned to the end, preserving relative order.
		_, err = tx.Exec(ctx, `
			UPDATE list_items SET position = $2 + position
			WHERE list_id = $1 AND song_id <> ALL($3)`, listID, len(songIDs), songIDs)
		if err != nil {
			return fmt.Errorf("reposition remaining list items: %w", translateErr(err))
		}
		return nil
	})
}

// ListIDsContainingSong reports which of a user's lists already hold a song, so
// the UI can render the correct toggle state without a request per list.
func (s *Store) ListIDsContainingSong(ctx context.Context, ownerID, songID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT li.list_id
		FROM list_items li
		JOIN lists l ON l.id = li.list_id
		WHERE l.owner_id = $1 AND li.song_id = $2`, ownerID, songID)
	if err != nil {
		return nil, fmt.Errorf("query lists containing song: %w", translateErr(err))
	}
	defer rows.Close()

	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan list id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
