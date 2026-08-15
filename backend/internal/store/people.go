package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PersonFilter narrows a people listing.
type PersonFilter struct {
	Query  string
	Role   CreditRole // restrict to people credited in this capacity
	Limit  int
	Offset int
}

// personColumns is the projection shared by every person read. The credited-song
// count is part of it so the two readers cannot disagree about how it is counted.
const personColumns = `p.id, p.name, p.created_at, p.updated_at,
	(SELECT count(DISTINCT sc.song_id) FROM song_credits sc WHERE sc.person_id = p.id)`

// scanPerson reads the personColumns projection in order.
func scanPerson(row pgx.Row, p *Person) error {
	return row.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.SongCount)
}

// ListPeople returns people matching the filter, with the number of songs each
// is credited on. Search here is trigram-based: the primary use is an
// autocomplete in the song editor, where tolerating a misspelled or
// transliterated name is the whole point.
func (s *Store) ListPeople(ctx context.Context, f PersonFilter) ([]Person, int, error) {
	f.Limit = clampLimit(f.Limit)

	a := &args{}
	conds := []string{"TRUE"}
	order := "p.name ASC"

	if q := strings.TrimSpace(f.Query); q != "" {
		p := a.next(q)
		// Prefix match OR trigram similarity: prefix keeps typing responsive,
		// similarity catches spelling drift once enough has been typed.
		conds = append(conds, fmt.Sprintf(
			"(p.normalized_name LIKE app_norm(%[1]s) || '%%' OR p.normalized_name %% app_norm(%[1]s))", p))
		order = fmt.Sprintf("similarity(p.normalized_name, app_norm(%s)) DESC, p.name ASC", p)
	}
	if f.Role != "" {
		conds = append(conds, fmt.Sprintf(
			"EXISTS (SELECT 1 FROM song_credits sc WHERE sc.person_id = p.id AND sc.role = %s)",
			a.next(string(f.Role))))
	}
	where := strings.Join(conds, " AND ")

	// Counted before the page query, which is what lets both share `a`: the
	// limit and offset placeholders below append to a.values, so reading them
	// first would bind two extra arguments the count statement never mentions.
	total, err := s.count(ctx, "count people", "SELECT count(*) FROM people p WHERE "+where, a.values...)
	if err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT %s
		FROM people p
		WHERE %s
		ORDER BY %s
		LIMIT %s OFFSET %s`, personColumns, where, order, a.next(f.Limit), a.next(f.Offset))

	people, err := queryAll(ctx, s, "people", query, scanPerson, a.values...)
	return people, total, err
}

// GetPerson loads one person.
func (s *Store) GetPerson(ctx context.Context, id uuid.UUID) (*Person, error) {
	var p Person
	query := "SELECT " + personColumns + " FROM people p WHERE p.id = $1"
	if err := scanPerson(s.pool.QueryRow(ctx, query, id), &p); err != nil {
		return nil, translateErr(err)
	}
	return &p, nil
}

// UpsertPerson returns the person with this name, creating them if new.
//
// Upsert rather than insert because the song editor lets contributors type a
// name directly: two people entering "Μάνος Χατζιδάκις" on different songs must
// converge on one record, or filtering by that composer would return half his
// catalog. Matching is on the normalized name, so casing and accents do not
// fragment the catalog either.
func (s *Store) UpsertPerson(ctx context.Context, name string) (*Person, error) {
	name, err := requireName("person", name)
	if err != nil {
		return nil, err
	}

	var p Person
	// DO UPDATE rather than DO NOTHING: DO NOTHING returns no row on conflict,
	// which would make the common "person already exists" path fail.
	//
	// Aliased to `p` so the shared personColumns projection applies verbatim;
	// the conflict target then has to say `p.name`, since `people.name` no
	// longer resolves once the alias exists.
	err = scanPerson(s.pool.QueryRow(ctx, `
		INSERT INTO people AS p (name) VALUES ($1)
		ON CONFLICT (normalized_name) DO UPDATE SET name = p.name
		RETURNING `+personColumns, name), &p)
	if err != nil {
		return nil, fmt.Errorf("upsert person: %w", translateErr(err))
	}
	return &p, nil
}

// UpdatePerson renames a person. The rename cascades into every affected song's
// search vector via trigger.
func (s *Store) UpdatePerson(ctx context.Context, id uuid.UUID, name string) (*Person, error) {
	name, err := requireName("person", name)
	if err != nil {
		return nil, err
	}

	var p Person
	err = scanPerson(s.pool.QueryRow(ctx, `
		UPDATE people AS p SET name = $2 WHERE p.id = $1
		RETURNING `+personColumns, id, name), &p)
	if err != nil {
		return nil, translateErr(err)
	}
	return &p, nil
}

// DeletePerson removes a person. The song_credits foreign key is ON DELETE
// RESTRICT, so this fails while they are still credited — deleting them would
// silently strip attribution from songs instead.
func (s *Store) DeletePerson(ctx context.Context, id uuid.UUID) error {
	// song_credits.person_id is the only RESTRICT-ed reference in the schema, so
	// people are the only rows this can actually fail on — but the ErrInUse
	// mapping lives in execExpectingRow with the rest of the delete contract,
	// rather than here, so callers ask a predicate instead of matching a
	// constraint name out of the message text.
	return s.execExpectingRow(ctx, "delete person", `DELETE FROM people WHERE id = $1`, id)
}
