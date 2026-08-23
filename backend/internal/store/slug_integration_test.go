package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/store"
	"github.com/christos/lyrics/backend/internal/testutil"
)

// slugInputs is deliberately not a table of expected outputs.
//
// What has to hold is that two implementations agree, not that either produces a
// particular string — so the assertion compares them against each other and the
// list below only has to cover the ground where they could diverge. TestSlugify
// next door is what pins the Go side to actual values.
var slugInputs = []string{
	"Rock",
	"Classic Rock",
	"Café Music",
	"Rock & Roll!",
	"  --Rock--  ",
	"Rock 1960",
	"!!!",
	"",

	// Greek is where a naive SQL port goes wrong: stripping marks alone leaves
	// a string with no ASCII in it at all, and the four letters with no
	// single-character Latin form are the ones a translate() misses.
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

// The SQL slugifier in migration 000010 is a mirror of store.Slugify, for the
// reason the migration states: the backfill has to run inside the migration, and
// Greek titles slugify to nothing without transliteration.
//
// This is the test that keeps the mirror honest. It is the same arrangement
// app_norm has with the app_simple configuration, and youtube.test.ts has with
// parseYouTubeURL: a rule written twice, with something asserting the two copies
// against each other rather than a comment asking the next reader to be careful.
func TestSongSlugMatchesSlugify(t *testing.T) {
	// Migrates the database as a side effect, which is what puts app_slugify
	// there to be called.
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

// Two songs may share a title — this catalog has seven such groups — so the slug
// cannot simply be the title's, and the suffix is the ordinary case rather than
// an edge one.
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

// The address must survive a retitle, or every shared link to a song breaks the
// first time somebody corrects its spelling. UpdateGenre keeps the same promise
// for a genre's slug; here a BEFORE INSERT trigger is what keeps it, so no
// writer in the store can break it by accident.
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

// A title of punctuation alone slugifies to nothing, and is still a title
// somebody is allowed to save — so it gets an address rather than a refusal. The
// genre path refuses instead, which is right there and would be wrong here: a
// song's title space is the whole world's.
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

// GET /songs/{ref} parses a UUID before it tries a slug, and the schema's CHECK
// accepts a UUID string as a well-formed slug — so a song titled like one would
// be shadowed by whatever song holds that id. The trigger refuses to mint one,
// which is what keeps the resolver's precedence unambiguous.
//
// Both spellings, because uuid.Parse takes both: the canonical dashed form and
// the same 32 hex digits without them. The undashed one is what a reservation
// written from the canonical form misses, and it is the one a title could
// plausibly produce — it needs no punctuation at all to survive slugification.
// Asserting the parse rather than a particular suffix is what makes this a
// statement about the resolver instead of about the numbering.
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
