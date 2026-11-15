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
		want  creditClass
		known bool
	}{
		// The old catalog's enum; "songwriter" means the lyricist.
		{"composer", classComposer, true},
		{"songwriter", classLyricist, true},
		{"COMPOSER", classComposer, true},
		{"μουσική", classComposer, true},
		{"μουσικη", classComposer, true}, // unaccented spelling agrees
		{"στιχουργός", classLyricist, true},
		// The performing vocabulary; "artist" goes to the recording.
		{"singer", classPerformer, true},
		{"artist", classPerformer, true},
		{"performer", classPerformer, true},
		{"ερμηνεία", classPerformer, true},
		{"producer", fallbackRole, false}, // unmapped: kept, but reported
		{"", fallbackRole, false},
	}
	for _, tt := range tests {
		got, known := normalizeRole(tt.in)
		if got != tt.want || known != tt.known {
			t.Errorf("normalizeRole(%q) = (%v, %v), want (%v, %v)",
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
	// A non-YouTube or malformed link must yield "" so the column stays NULL.
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

	// An out-of-range year leaves nothing for a recording, so none is made.
	t.Run("out-of-range year becomes NULL", func(t *testing.T) {
		w := newWarnings()
		s, err := record{Title: "x", ReleaseYear: &badYear}.clean(w)
		if err != nil {
			t.Fatal(err)
		}
		if len(s.recordings) != 0 {
			t.Errorf("recordings = %v, want none once the year is dropped", s.recordings)
		}
		if len(w.order) != 1 {
			t.Errorf("expected the adjustment to be reported, got %d warnings", len(w.order))
		}
	})

	// A year alone synthesizes the first recording.
	t.Run("in-range year is kept on a synthesized first recording", func(t *testing.T) {
		w := newWarnings()
		s, err := record{Title: "x", ReleaseYear: &goodYear}.clean(w)
		if err != nil {
			t.Fatal(err)
		}
		if len(s.recordings) != 1 {
			t.Fatalf("recordings = %v, want one", s.recordings)
		}
		rec := s.recordings[0]
		if rec.releaseYear == nil || *rec.releaseYear != goodYear {
			t.Errorf("releaseYear = %v, want %d", rec.releaseYear, goodYear)
		}
		if !rec.isFirst {
			t.Error("the synthesized recording is not marked as the first")
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
	// primary key; in two different roles it is legitimate and must survive.
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

	// Distinct songs sharing a title must not collide, or songs are lost.
	c := fingerprint("Ο χωρισμός", []string{"Βασίλης Τσιτσάνης"})
	d := fingerprint("Ο χωρισμός", []string{"Μάρκος Βαμβακάρης"})
	if c == d {
		t.Error("songs with the same title but different credits share a fingerprint")
	}
}

// Authorship stays on the song and performance goes to its recording, matching
// migration 000009 so a re-import does not duplicate the song.
func TestCleanSplitsCreditsFromPerformers(t *testing.T) {
	w := newWarnings()
	year := 1964
	s, err := record{
		Title:       "Θάλασσα Πλατιά",
		ReleaseYear: &year,
		YouTubeURL:  ptr("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
		Credits: []credit{
			{Name: "Μίκης Θεοδωράκης", Role: "composer"},
			{Name: "Νίκος Γκάτσος", Role: "songwriter"},
			{Name: "Γιώργος Νταλάρας", Role: "artist"},
		},
	}.clean(w)
	if err != nil {
		t.Fatal(err)
	}

	if len(s.credits) != 2 {
		t.Fatalf("credits = %v, want the composer and the lyricist only", s.credits)
	}
	for _, c := range s.credits {
		if c.role != store.CreditComposer && c.role != store.CreditLyricist {
			t.Errorf("credit %q has role %q, want authorship only", c.name, c.role)
		}
	}

	if len(s.recordings) != 1 {
		t.Fatalf("recordings = %v, want one synthesized", s.recordings)
	}
	rec := s.recordings[0]
	if !rec.isFirst {
		t.Error("the synthesized recording is not marked as the first")
	}
	if rec.releaseYear == nil || *rec.releaseYear != year {
		t.Errorf("recording year = %v, want %d", rec.releaseYear, year)
	}
	if rec.youTubeVideoID == nil || *rec.youTubeVideoID != "dQw4w9WgXcQ" {
		t.Errorf("recording video id = %v, want it parsed", rec.youTubeVideoID)
	}
	if len(rec.performers) != 1 || rec.performers[0].name != "Γιώργος Νταλάρας" {
		t.Errorf("performers = %v, want just the artist credit", rec.performers)
	}
}

// A record saying nothing about any performance gets no recording.
func TestCleanSynthesizesNoRecordingWithoutOne(t *testing.T) {
	w := newWarnings()
	s, err := record{
		Title:   "Μόνο Στίχοι",
		Lyrics:  "στίχοι",
		Credits: []credit{{Name: "Μίκης Θεοδωράκης", Role: "composer"}},
	}.clean(w)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.recordings) != 0 {
		t.Errorf("recordings = %v, want none", s.recordings)
	}
}

// An explicit recordings array is taken as given, and of two firsts the first
// claim wins (two would violate the unique index).
func TestCleanTakesExplicitRecordings(t *testing.T) {
	w := newWarnings()
	s, err := record{
		Title: "Πολλές Εκτελέσεις",
		Recordings: []recordingRecord{
			{Label: ptr("1964"), IsFirst: ptr(true), Performers: []performer{{Name: "Α"}}},
			{Label: ptr("1988"), IsFirst: ptr(true), Performers: []performer{{Name: "Β"}}},
		},
	}.clean(w)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.recordings) != 2 {
		t.Fatalf("recordings = %v, want both", s.recordings)
	}
	if !s.recordings[0].isFirst {
		t.Error("the first claim was not kept")
	}
	if s.recordings[1].isFirst {
		t.Error("the second claim was kept too, which the unique index refuses")
	}
	if s.recordings[1].position != 1 {
		t.Errorf("second position = %d, want 1", s.recordings[1].position)
	}
}

// Performers count towards the fingerprint, so a re-import of the same export
// recognizes the song the migration produced instead of inserting it again.
func TestFingerprintCountsPerformers(t *testing.T) {
	w := newWarnings()
	s, err := record{
		Title:   "Θάλασσα Πλατιά",
		Credits: []credit{{Name: "Γιώργος Νταλάρας", Role: "artist"}},
	}.clean(w)
	if err != nil {
		t.Fatal(err)
	}
	// What the stored row yields via either table.
	want := fingerprint("Θάλασσα Πλατιά", []string{"Γιώργος Νταλάρας"})
	if got := s.fingerprint(); got != want {
		t.Errorf("fingerprint = %q, want %q — a re-import would duplicate the song", got, want)
	}
}

func ptr[T any](v T) *T { return &v }
