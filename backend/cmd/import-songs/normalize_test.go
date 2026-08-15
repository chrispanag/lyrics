package main

import (
	"testing"

	"github.com/christos/lyrics/backend/internal/store"
)

func TestNormalizeLanguage(t *testing.T) {
	tests := []struct {
		in    string
		want  string
		exact bool
	}{
		{"", "el", true}, // absent, not wrong: falls back silently
		{"el", "el", true},
		{"EL", "el", true},
		{"gr", "el", true}, // the common wrong code for Greek
		{"Greek", "el", true},
		{"ελληνικά", "el", true},
		{"en-US", "en", true}, // BCP-47 narrowed to its primary subtag
		{"el_GR", "el", true},
		{"english", "en", true},
		{"klingon", "el", false}, // unrecognized: reported, not stored
		{"123", "el", false},
	}
	for _, tt := range tests {
		got, exact := normalizeLanguage(tt.in)
		if got != tt.want || exact != tt.exact {
			t.Errorf("normalizeLanguage(%q) = (%q, %v), want (%q, %v)",
				tt.in, got, exact, tt.want, tt.exact)
		}
	}
}

func TestNormalizeRole(t *testing.T) {
	tests := []struct {
		in    string
		want  store.CreditRole
		known bool
	}{
		// The old catalog's enum. "songwriter" is the load-bearing case: it
		// means whoever wrote the words, which this schema calls a lyricist.
		{"composer", store.CreditComposer, true},
		{"songwriter", store.CreditLyricist, true},
		{"COMPOSER", store.CreditComposer, true},
		{"μουσική", store.CreditComposer, true},
		{"μουσικη", store.CreditComposer, true}, // unaccented spelling agrees
		{"στιχουργός", store.CreditLyricist, true},
		{"singer", store.CreditPerformer, true},
		{"artist", store.CreditArtist, true},
		{"performer", store.CreditPerformer, true},
		{"producer", fallbackRole, false}, // unmapped: kept, but reported
		{"", fallbackRole, false},
	}
	for _, tt := range tests {
		got, known := normalizeRole(tt.in)
		if got != tt.want || known != tt.known {
			t.Errorf("normalizeRole(%q) = (%q, %v), want (%q, %v)",
				tt.in, got, known, tt.want, tt.known)
		}
	}
}

func TestYouTubeVideoID(t *testing.T) {
	const id = "dQw4w9WgXcQ"
	for _, in := range []string{
		id,
		"https://www.youtube.com/watch?v=" + id,
		"https://youtube.com/watch?v=" + id + "&list=PL123",
		"https://youtu.be/" + id,
		"https://www.youtube.com/embed/" + id,
		"https://www.youtube.com/shorts/" + id,
		"https://www.youtube-nocookie.com/embed/" + id,
	} {
		if got := youTubeVideoID(in); got != id {
			t.Errorf("youTubeVideoID(%q) = %q, want %q", in, got, id)
		}
	}
	// A non-YouTube or malformed link must yield "" so the column stays NULL
	// rather than holding a wrong identifier.
	for _, in := range []string{"", "https://vimeo.com/12345", "not a url", "https://youtu.be/tooshort"} {
		if got := youTubeVideoID(in); got != "" {
			t.Errorf("youTubeVideoID(%q) = %q, want empty", in, got)
		}
	}
}

func TestCleanAppliesSchemaConstraints(t *testing.T) {
	empty, alt := "", "Χάρτινο το φεγγαράκι"
	badYear, goodYear := 0, 1935

	t.Run("blank title is rejected", func(t *testing.T) {
		w := newWarnings()
		if _, err := (record{Title: "   "}).clean(w); err == nil {
			t.Fatal("expected an error for a blank title")
		}
	})

	t.Run("empty alt title becomes NULL", func(t *testing.T) {
		w := newWarnings()
		s, err := record{Title: "Τα καναρια", AltTitle: &empty}.clean(w)
		if err != nil {
			t.Fatal(err)
		}
		if s.altTitle != nil {
			t.Errorf("altTitle = %q, want nil", *s.altTitle)
		}
	})

	t.Run("alt title repeating the title is dropped", func(t *testing.T) {
		w := newWarnings()
		s, err := record{Title: "Χάρτινο το Φεγγαράκι", AltTitle: &alt}.clean(w)
		if err != nil {
			t.Fatal(err)
		}
		if s.altTitle != nil {
			t.Errorf("altTitle = %q, want nil (differs from title only by case)", *s.altTitle)
		}
	})

	t.Run("out-of-range year becomes NULL", func(t *testing.T) {
		w := newWarnings()
		s, err := record{Title: "x", ReleaseYear: &badYear}.clean(w)
		if err != nil {
			t.Fatal(err)
		}
		if s.releaseYear != nil {
			t.Errorf("releaseYear = %d, want nil", *s.releaseYear)
		}
		if len(w.order) != 1 {
			t.Errorf("expected the adjustment to be reported, got %d warnings", len(w.order))
		}
	})

	t.Run("in-range year is kept", func(t *testing.T) {
		w := newWarnings()
		s, err := record{Title: "x", ReleaseYear: &goodYear}.clean(w)
		if err != nil {
			t.Fatal(err)
		}
		if s.releaseYear == nil || *s.releaseYear != goodYear {
			t.Errorf("releaseYear = %v, want %d", s.releaseYear, goodYear)
		}
	})

	t.Run("CRLF is normalized", func(t *testing.T) {
		w := newWarnings()
		s, err := record{Title: "x", Lyrics: "a\r\nb\rc"}.clean(w)
		if err != nil {
			t.Fatal(err)
		}
		if s.lyrics != "a\nb\nc" {
			t.Errorf("lyrics = %q, want %q", s.lyrics, "a\nb\nc")
		}
	})
}

func TestCleanCreditsDeduplicates(t *testing.T) {
	w := newWarnings()
	// The same person in the same role twice would violate the song_credits
	// primary key mid-transaction; in two different roles it is legitimate and
	// must survive (487 songs in the source catalog look like this).
	s, err := record{
		Title: "Φραγκοσυριανή",
		Credits: []credit{
			{Name: "Μάρκος Βαμβακάρης", Role: "composer"},
			{Name: "μαρκος βαμβακαρης", Role: "composer"}, // same person, folded
			{Name: "Μάρκος Βαμβακάρης", Role: "songwriter"},
			{Name: "   ", Role: "composer"}, // blank name would fail the CHECK
		},
	}.clean(w)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.credits) != 2 {
		t.Fatalf("got %d credits, want 2: %+v", len(s.credits), s.credits)
	}
	if s.credits[0].role != store.CreditComposer || s.credits[1].role != store.CreditLyricist {
		t.Errorf("roles = %q/%q, want composer/lyricist", s.credits[0].role, s.credits[1].role)
	}
}

func TestCleanGenresRejectsUnslugifiableNames(t *testing.T) {
	w := newWarnings()
	s, err := record{Title: "x", Genres: []string{"Έντεχνο", "έντεχνο", "!!!", "  ", "Rock"}}.clean(w)
	if err != nil {
		t.Fatal(err)
	}
	// "έντεχνο" collapses onto "Έντεχνο" by slug; "!!!" yields no usable slug
	// and cannot satisfy the genres.slug CHECK at all.
	if len(s.genres) != 2 {
		t.Fatalf("got genres %v, want 2 entries", s.genres)
	}
}

func TestFingerprintIgnoresCreditOrderAndCase(t *testing.T) {
	a := fingerprint("Χάρτινο το Φεγγαράκι", []string{"Μάνος Χατζιδάκις", "Νίκος Γκάτσος"})
	b := fingerprint("χάρτινο το φεγγαράκι", []string{"Νίκος Γκάτσος", "μανος χατζιδακις"})
	if a != b {
		t.Errorf("fingerprints differ:\n  %q\n  %q", a, b)
	}

	// Distinct songs sharing a title must not collide — the source catalog has
	// seven such groups, and collapsing them would silently lose songs.
	c := fingerprint("Ο χωρισμός", []string{"Βασίλης Τσιτσάνης"})
	d := fingerprint("Ο χωρισμός", []string{"Μάρκος Βαμβακάρης"})
	if c == d {
		t.Error("songs with the same title but different credits share a fingerprint")
	}
}
