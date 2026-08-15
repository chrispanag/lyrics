package store

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// genreColumns is the projection shared by every genre read and write. The song
// count is part of it so the readers cannot disagree about how it is counted,
// and writes report the same shape the listing does. Qualified with `g.`, so
// the write statements alias their target table.
const genreColumns = `g.id, g.name, g.slug, g.created_at, g.updated_at,
	(SELECT count(*) FROM song_genres sg WHERE sg.genre_id = g.id)`

// scanGenre reads the genreColumns projection in order.
func scanGenre(row pgx.Row, g *Genre) error {
	return row.Scan(&g.ID, &g.Name, &g.Slug, &g.CreatedAt, &g.UpdatedAt, &g.SongCount)
}

// ListGenres returns every genre with its song count. The catalog holds a few
// dozen genres at most, so this is deliberately unpaginated — the frontend
// renders the whole set as filter chips.
func (s *Store) ListGenres(ctx context.Context) ([]Genre, error) {
	return queryAll(ctx, s, "genre", `
		SELECT `+genreColumns+`
		FROM genres g
		ORDER BY g.name`, scanGenre)
}

// CreateGenre adds a genre, deriving its slug from the name.
func (s *Store) CreateGenre(ctx context.Context, name string) (*Genre, error) {
	name, err := requireName("genre", name)
	if err != nil {
		return nil, err
	}
	slug := Slugify(name)
	if slug == "" {
		return nil, fmt.Errorf("%w: genre name %q does not yield a usable slug", ErrInvalid, name)
	}

	var g Genre
	err = scanGenre(s.pool.QueryRow(ctx, `
		INSERT INTO genres AS g (name, slug) VALUES ($1, $2)
		RETURNING `+genreColumns, name, slug), &g)
	if err != nil {
		return nil, fmt.Errorf("create genre: %w", translateErr(err))
	}
	return &g, nil
}

// UpdateGenre renames a genre, leaving the slug alone so existing links and
// bookmarked filter URLs keep working.
func (s *Store) UpdateGenre(ctx context.Context, id uuid.UUID, name string) (*Genre, error) {
	name, err := requireName("genre", name)
	if err != nil {
		return nil, err
	}

	var g Genre
	err = scanGenre(s.pool.QueryRow(ctx, `
		UPDATE genres AS g SET name = $2 WHERE g.id = $1
		RETURNING `+genreColumns, id, name), &g)
	if err != nil {
		return nil, translateErr(err)
	}
	return &g, nil
}

// DeleteGenre removes a genre; its song associations cascade away.
func (s *Store) DeleteGenre(ctx context.Context, id uuid.UUID) error {
	return s.execExpectingRow(ctx, "delete genre", `DELETE FROM genres WHERE id = $1`, id)
}

// greekToLatin transliterates the Greek alphabet, roughly following ISO 843.
//
// Stripping combining marks alone is not enough for this catalog: "Έντεχνο"
// would decompose to "Εντεχνο", which is still entirely non-ASCII and would
// slugify to the empty string — making it impossible to create a Greek-named
// genre at all. Transliteration instead yields "entechno", which is both valid
// and readable in a URL.
var greekToLatin = map[rune]string{
	'α': "a", 'β': "v", 'γ': "g", 'δ': "d", 'ε': "e", 'ζ': "z", 'η': "i",
	'θ': "th", 'ι': "i", 'κ': "k", 'λ': "l", 'μ': "m", 'ν': "n", 'ξ': "x",
	'ο': "o", 'π': "p", 'ρ': "r", 'σ': "s", 'ς': "s", 'τ': "t", 'υ': "y",
	'φ': "f", 'χ': "ch", 'ψ': "ps", 'ω': "o",
}

// Slugify converts a display name into a URL-safe slug matching the schema's
// `^[a-z0-9]+(-[a-z0-9]+)*$` constraint.
//
// Returns "" when a name yields no usable characters at all (a name of only
// punctuation, or a script we do not transliterate). Callers must handle that
// rather than assume a slug always materializes.
func Slugify(name string) string {
	// Decompose, drop combining marks, recompose: "Έντεχνο" -> "Εντεχνο",
	// "Café" -> "Cafe". This runs before transliteration so the Greek map only
	// needs unaccented letters.
	stripMarks := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	folded, _, err := transform.String(stripMarks, name)
	if err != nil {
		folded = name
	}

	var b strings.Builder
	lastWasDash := true // a leading dash is never valid
	for _, r := range strings.ToLower(folded) {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastWasDash = false
		default:
			if latin, ok := greekToLatin[r]; ok {
				b.WriteString(latin)
				lastWasDash = false
				continue
			}
			if !lastWasDash {
				b.WriteRune('-')
				lastWasDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}
