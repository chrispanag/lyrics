package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/store"
	"github.com/christos/lyrics/backend/internal/testutil"
)

// slugInputs is not a table of expected outputs: the test compares the two
// implementations, so it only covers where they could diverge. TestSlugify pins
// the Go side to values.
var slugInputs = []string{
	"Rock",
	"Classic Rock",
	"Café Music",
	"Rock & Roll!",
	"  --Rock--  ",
	"Rock 1960",
	"!!!",
	"",

	// Greek is where a naive SQL port goes wrong, especially the letters with
	// multi-character Latin forms that a translate() misses.
	"Έντεχνο",
	"Λαϊκό Τραγούδι",
	"Ρεμπέτικος",
	"Greek Ρεμπέτικο",
	"Το τελευταίο τραγούδι",
	"Χάρτινο το Φεγγαράκι",
	"Ψυχή και Ξένος",
	"Θάλασσα Πλατιά",
	"Συννεφιασμένη Κυριακή",
	"Ο χωρισμός",
	"ΟΛΑ ΚΕΦΑΛΑΙΑ",
	"τελος με ς και σ",
}

// app_slugify (migration 000010) mirrors store.Slugify; this keeps them in step.
func TestSongSlugMatchesSlugify(t *testing.T) {
	// Migrates the database, which creates app_slugify.
	st := testutil.NewStore(t)

	for _, input := range slugInputs {
		t.Run(input, func(t *testing.T) {
			var got string
			if err := st.Pool().QueryRow(context.Background(),
				"SELECT app_slugify($1)", input).Scan(&got); err != nil {
				t.Fatalf("app_slugify(%q): %v", input, err)
			}
			if want := store.Slugify(input); got != want {
				t.Errorf("app_slugify(%q) = %q, store.Slugify = %q", input, got, want)
			}
		})
	}
}

// Titles are not unique, so a suffix is the ordinary case.
func TestSongsSharingATitleGetDistinctSlugs(t *testing.T) {
	st := testutil.NewStore(t)

	first := createSongTitled(t, st, "Ο χωρισμός")
	second := createSongTitled(t, st, "Ο χωρισμός")

	if first.Slug == second.Slug {
		t.Fatalf("both songs got the slug %q", first.Slug)
	}
	if first.Slug != "o-chorismos" {
		t.Errorf("first slug = %q, want the unsuffixed form", first.Slug)
	}
	if second.Slug != "o-chorismos-2" {
		t.Errorf("second slug = %q, want the first one suffixed", second.Slug)
	}
}

// The address must survive a retitle, or shared links break.
func TestRetitlingASongLeavesItsSlugAlone(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	song := createSongTitled(t, st, "Θάλασσα Πλατιά")
	before := song.Slug

	updated, err := st.UpdateSong(ctx, song.ID, store.SongInput{
		Title:    "Θάλασσα Πλατειά",
		Language: "el",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("UpdateSong: %v", err)
	}

	if updated.Slug != before {
		t.Errorf("slug moved from %q to %q on a retitle", before, updated.Slug)
	}
}

// A title that slugifies to nothing still gets an address (unlike a genre,
// which is refused).
func TestASongWithNoSlugifiableTitleStillGetsAnAddress(t *testing.T) {
	st := testutil.NewStore(t)

	song := createSongTitled(t, st, "???")

	if song.Slug == "" {
		t.Fatal("song has no address at all")
	}
	if song.Slug != "song" {
		t.Errorf("slug = %q, want the generic fallback", song.Slug)
	}
}

// `new` is the editor's own address, so a song may not hold it: both routers
// rank a static segment above a dynamic one, and that song would be unreachable
// with its URL opening a blank editor instead.
func TestASongIsNeverSluggedNew(t *testing.T) {
	st := testutil.NewStore(t)

	song := createSongTitled(t, st, "New")

	if song.Slug == "new" {
		t.Fatal("a song took the editor's address")
	}
	if song.Slug != "new-2" {
		t.Errorf("slug = %q, want the reserved form suffixed", song.Slug)
	}
}

// The resolver parses a UUID before trying a slug, so a UUID-shaped slug would
// be shadowed. Both spellings uuid.Parse accepts: dashed and bare 32 hex digits.
func TestASongSlugIsNeverUUIDShaped(t *testing.T) {
	for _, shaped := range []string{
		"6f2a1c3e-9b04-4d21-8f77-1a2b3c4d5e6f",
		"6f2a1c3e9b044d218f771a2b3c4d5e6f",
	} {
		t.Run(shaped, func(t *testing.T) {
			st := testutil.NewStore(t)

			song := createSongTitled(t, st, shaped)

			if _, err := uuid.Parse(song.Slug); err == nil {
				t.Fatalf("slug %q cannot be told from an identifier", song.Slug)
			}
		})
	}
}

func createSongTitled(t *testing.T, st *store.Store, title string) *store.Song {
	t.Helper()

	song, err := st.CreateSong(context.Background(), store.SongInput{
		Title:    title,
		Language: "el",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("CreateSong(%q): %v", title, err)
	}
	return song
}
