package store_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/store"
	"github.com/christos/lyrics/backend/internal/testutil"
)

// seedCatalog inserts a small multilingual catalog used across the search tests.
func seedCatalog(t *testing.T, st *store.Store) map[string]*store.Song {
	t.Helper()
	ctx := context.Background()

	theodorakis, err := st.UpsertPerson(ctx, "Μίκης Θεοδωράκης")
	if err != nil {
		t.Fatalf("upsert person: %v", err)
	}
	dalaras, err := st.UpsertPerson(ctx, "Γιώργος Νταλάρας")
	if err != nil {
		t.Fatalf("upsert person: %v", err)
	}
	cave, err := st.UpsertPerson(ctx, "Nick Cave")
	if err != nil {
		t.Fatalf("upsert person: %v", err)
	}

	entechno, err := st.CreateGenre(ctx, "Έντεχνο")
	if err != nil {
		t.Fatalf("create genre: %v", err)
	}
	rock, err := st.CreateGenre(ctx, "Rock")
	if err != nil {
		t.Fatalf("create genre: %v", err)
	}

	songs := map[string]*store.Song{}
	seed := []struct {
		key   string
		input store.SongInput
	}{
		// "sea" is the shape most of the catalog has: written by one person,
		// performed by another, the performance carrying the year.
		{"sea", store.SongInput{
			Title:    "Θάλασσα Πλατιά",
			Lyrics:   "Στης θάλασσας τα βάθη\nη αγάπη μου κοιμάται",
			Language: "el",
			Credits: []store.Credit{
				{PersonID: theodorakis.ID, Role: store.CreditComposer},
			},
			Recordings: []store.RecordingInput{{
				ReleaseYear: ptr(1964),
				IsFirst:     true,
				Performers: []store.RecordingPerformer{
					{PersonID: dalaras.ID},
				},
			}},
			GenreIDs: []uuid.UUID{entechno.ID},
		}},
		// "love" has no recording at all, which after the split is a real state
		// and not a broken one: 85 songs in the live catalog are in it.
		{"love", store.SongInput{
			// Mentions the sea only in the lyrics, so it must rank below "sea"
			// for a sea query but above nothing.
			Title:    "Το Τραγούδι της Αγάπης",
			Lyrics:   "Μια μέρα στη θάλασσα\nθα σε ξαναδώ",
			Language: "el",
			Credits: []store.Credit{
				{PersonID: theodorakis.ID, Role: store.CreditLyricist},
			},
		}},
		// "arms" is written and performed by the same person, so it is what
		// pins that such a name is counted once wherever names are gathered.
		{"arms", store.SongInput{
			Title:    "Into My Arms",
			Lyrics:   "I do not believe in an interventionist God\nBut I know darling that you do",
			Language: "en",
			Credits: []store.Credit{
				{PersonID: cave.ID, Role: store.CreditComposer},
			},
			Recordings: []store.RecordingInput{{
				ReleaseYear: ptr(1997),
				IsFirst:     true,
				Performers: []store.RecordingPerformer{
					{PersonID: cave.ID},
				},
			}},
			GenreIDs: []uuid.UUID{rock.ID},
		}},
	}

	for _, s := range seed {
		song, err := st.CreateSong(ctx, s.input, uuid.Nil)
		if err != nil {
			t.Fatalf("create song %q: %v", s.input.Title, err)
		}
		songs[s.key] = song
	}
	return songs
}

// createSong needs a real creator, so tests that assert on created_by make one.
func seedUser(t *testing.T, st *store.Store, email string, role store.Role) *store.User {
	t.Helper()
	user, err := st.ProvisionUser(context.Background(), "usr_"+email, email, role)
	if err != nil {
		t.Fatalf("provision user: %v", err)
	}
	return user
}

func ptr[T any](v T) *T { return &v }

func titles(songs []store.Song) []string {
	out := make([]string, len(songs))
	for i, s := range songs {
		out[i] = s.Title
	}
	return out
}

func TestSearchDiacriticInsensitive(t *testing.T) {
	st := testutil.NewStore(t)
	seedCatalog(t, st)

	// The accented and unaccented spellings must be interchangeable in both
	// directions: users type Greek with and without accents interchangeably.
	for _, query := range []string{"θάλασσα", "θαλασσα", "ΘΑΛΑΣΣΑ", "Θάλασσα"} {
		t.Run(query, func(t *testing.T) {
			songs, total, err := st.ListSongs(context.Background(), store.SongFilter{Query: query})
			if err != nil {
				t.Fatalf("ListSongs: %v", err)
			}
			if total != 2 {
				t.Fatalf("total = %d, want 2 (got %v)", total, titles(songs))
			}
			if songs[0].Title != "Θάλασσα Πλατιά" {
				t.Errorf("first result = %q, want the title match to outrank the lyrics match",
					songs[0].Title)
			}
		})
	}
}

// Matching and highlighting fail independently: the search vector is built from
// normalized text while ts_headline reads the raw lyrics. A test that only
// checks matching would not notice highlighting silently degrading to "the
// first N words of the song".
func TestSearchHighlightsAccentedGreek(t *testing.T) {
	st := testutil.NewStore(t)
	seedCatalog(t, st)

	songs, _, err := st.ListSongs(context.Background(), store.SongFilter{Query: "θάλασσας"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if len(songs) == 0 {
		t.Fatal("expected at least one result")
	}

	var found bool
	for _, s := range songs {
		if s.Snippet == nil {
			t.Fatalf("song %q has no snippet", s.Title)
		}
		if strings.Contains(*s.Snippet, store.SnippetStartSel) {
			found = true
		}
	}
	if !found {
		var got []string
		for _, s := range songs {
			got = append(got, *s.Snippet)
		}
		t.Errorf("no snippet contained a %q highlight delimiter; got %q", store.SnippetStartSel, got)
	}
}

func TestSearchToleratesMisspelledArtist(t *testing.T) {
	st := testutil.NewStore(t)
	seedCatalog(t, st)

	// "Θεοδορακης" drops a letter and the accents from "Θεοδωράκης".
	songs, total, err := st.ListSongs(context.Background(), store.SongFilter{Query: "Θεοδορακης"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total == 0 {
		t.Fatal("expected trigram similarity to match a misspelled artist name")
	}
	for _, s := range songs {
		if s.Score == nil {
			t.Errorf("song %q has no relevance score", s.Title)
		}
	}
}

// Fuzzy matching must not decay as a song accumulates credits.
//
// Scoring the query against the whole concatenated credits field means every
// extra name dilutes the score, so the songs with the richest metadata are the
// first to stop matching a misspelling — the opposite of what anyone expects.
// word_similarity scores against the best-matching run of words instead, which
// is what this pins down.
//
// The four extra names are performers on a recording, which is also what makes
// this the test that a performer reaches credits_text at all: without the union
// in refresh_songs_denorm the field holds one name and the dilution being
// guarded against cannot even occur.
func TestFuzzyArtistMatchSurvivesManyCredits(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	target, err := st.UpsertPerson(ctx, "Μίκης Θεοδωράκης")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}

	var performers []store.RecordingPerformer
	for i, name := range []string{
		"Γιώργος Νταλάρας", "Χάρις Αλεξίου", "Νίκος Γκάτσος", "Μάνος Χατζιδάκις",
	} {
		person, err := st.UpsertPerson(ctx, name)
		if err != nil {
			t.Fatalf("UpsertPerson(%q): %v", name, err)
		}
		performers = append(performers, store.RecordingPerformer{PersonID: person.ID, Position: i})
	}

	if _, err := st.CreateSong(ctx, store.SongInput{
		Title:      "Πολλοί Συντελεστές",
		Lyrics:     "στίχοι",
		Language:   "el",
		Credits:    []store.Credit{{PersonID: target.ID, Role: store.CreditComposer}},
		Recordings: []store.RecordingInput{{IsFirst: true, Performers: performers}},
	}, uuid.Nil); err != nil {
		t.Fatalf("CreateSong: %v", err)
	}

	_, total, err := st.ListSongs(ctx, store.SongFilter{Query: "Θεοδορακης"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total == 0 {
		t.Error("a misspelled artist stopped matching once the song had five credits")
	}
}

// A person attached to a song twice must appear once in the denormalized field,
// not once per attachment.
//
// The two attachments are deliberately one of each kind — a credit on the work
// and a performance of it — because that is the pairing the UNION in
// refresh_songs_denorm has to collapse, and the one a per-table DISTINCT would
// not. Cohen wrote Hallelujah and sang it.
func TestCreditsTextIsDeduplicated(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	person, err := st.UpsertPerson(ctx, "Leonard Cohen")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}

	song, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Hallelujah",
		Lyrics:   "a secret chord",
		Language: "en",
		Credits: []store.Credit{
			{PersonID: person.ID, Role: store.CreditComposer},
			{PersonID: person.ID, Role: store.CreditLyricist},
		},
		Recordings: []store.RecordingInput{{
			IsFirst:    true,
			Performers: []store.RecordingPerformer{{PersonID: person.ID}},
		}},
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("CreateSong: %v", err)
	}

	var creditsText string
	err = st.Pool().QueryRow(ctx, `SELECT credits_text FROM songs WHERE id = $1`, song.ID).
		Scan(&creditsText)
	if err != nil {
		t.Fatalf("read credits_text: %v", err)
	}

	if strings.Count(creditsText, "Leonard Cohen") != 1 {
		t.Errorf("credits_text = %q, want the name exactly once", creditsText)
	}
}

// Greek is heavily inflected and the index is deliberately unstemmed, so prefix
// matching is the only thing connecting a search for the nominative to lyrics
// written in the genitive.
func TestSearchMatchesGreekInflection(t *testing.T) {
	st := testutil.NewStore(t)
	seedCatalog(t, st)

	_, total, err := st.ListSongs(context.Background(), store.SongFilter{Query: "αγαπ"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total < 2 {
		t.Errorf("total = %d, want the prefix to match both 'Αγάπης' and 'αγάπη'", total)
	}
}

func TestSearchEnglish(t *testing.T) {
	st := testutil.NewStore(t)
	seedCatalog(t, st)

	songs, total, err := st.ListSongs(context.Background(), store.SongFilter{Query: "interventionist"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total != 1 || songs[0].Title != "Into My Arms" {
		t.Errorf("got %v, want just \"Into My Arms\"", titles(songs))
	}
}

// A query made only of punctuation must return nothing rather than erroring:
// `to_tsquery` rejects an empty quoted lexeme outright.
func TestSearchHandlesUnusableQuery(t *testing.T) {
	st := testutil.NewStore(t)
	seedCatalog(t, st)

	for _, query := range []string{"...", "&&&", "!!! ???", "'"} {
		t.Run(query, func(t *testing.T) {
			_, total, err := st.ListSongs(context.Background(), store.SongFilter{Query: query})
			if err != nil {
				t.Fatalf("ListSongs(%q): %v", query, err)
			}
			if total != 0 {
				t.Errorf("total = %d, want 0", total)
			}
		})
	}
}

func TestFiltersIntersect(t *testing.T) {
	st := testutil.NewStore(t)
	songs := seedCatalog(t, st)
	ctx := context.Background()

	sea := songs["sea"]
	var composerID, performerID uuid.UUID
	for _, c := range sea.Credits {
		if c.Role == store.CreditComposer {
			composerID = c.PersonID
		}
	}
	if len(sea.Recordings) > 0 && len(sea.Recordings[0].Performers) > 0 {
		performerID = sea.Recordings[0].Performers[0].PersonID
	}
	if composerID == uuid.Nil || performerID == uuid.Nil {
		t.Fatal("fixture is missing expected credits")
	}

	t.Run("single credit filter", func(t *testing.T) {
		_, total, err := st.ListSongs(ctx, store.SongFilter{ComposerID: &composerID})
		if err != nil {
			t.Fatalf("ListSongs: %v", err)
		}
		if total != 1 {
			t.Errorf("total = %d, want 1", total)
		}
	})

	// A credit filter and a performer filter must intersect, and they now read
	// two different tables — so this is also what says the two EXISTS clauses
	// compose rather than one of them widening the result.
	t.Run("two credit filters intersect", func(t *testing.T) {
		got, total, err := st.ListSongs(ctx, store.SongFilter{
			ComposerID:  &composerID,
			PerformerID: &performerID,
		})
		if err != nil {
			t.Fatalf("ListSongs: %v", err)
		}
		if total != 1 {
			t.Fatalf("total = %d, want exactly 1 (got %v)", total, titles(got))
		}
		if got[0].ID != sea.ID {
			t.Errorf("got %q, want %q", got[0].Title, sea.Title)
		}
	})

	// The lyricist wrote a different song, so combining the two must match none.
	t.Run("non-overlapping filters match nothing", func(t *testing.T) {
		lyricistOnly := songs["love"]
		var lyricistID uuid.UUID
		for _, c := range lyricistOnly.Credits {
			if c.Role == store.CreditLyricist {
				lyricistID = c.PersonID
			}
		}
		_, total, err := st.ListSongs(ctx, store.SongFilter{
			PerformerID: &performerID,
			LyricistID:  &lyricistID,
		})
		if err != nil {
			t.Fatalf("ListSongs: %v", err)
		}
		if total != 0 {
			t.Errorf("total = %d, want 0", total)
		}
	})

	t.Run("genre and language filters", func(t *testing.T) {
		_, total, err := st.ListSongs(ctx, store.SongFilter{GenreSlug: "rock"})
		if err != nil {
			t.Fatalf("ListSongs: %v", err)
		}
		if total != 1 {
			t.Errorf("genre slug total = %d, want 1", total)
		}

		_, total, err = st.ListSongs(ctx, store.SongFilter{Language: "el"})
		if err != nil {
			t.Fatalf("ListSongs: %v", err)
		}
		if total != 2 {
			t.Errorf("language total = %d, want 2", total)
		}
	})

	// Filters must still apply when a relevance query is present, not just in
	// browse mode.
	t.Run("filters compose with search", func(t *testing.T) {
		_, total, err := st.ListSongs(ctx, store.SongFilter{
			Query:     "θαλασσα",
			GenreSlug: "entechno",
		})
		if err != nil {
			t.Fatalf("ListSongs: %v", err)
		}
		if total != 1 {
			t.Errorf("total = %d, want 1 (the genre filter should exclude the other match)", total)
		}
	})
}

// Renaming a person must reindex every song crediting them, or a corrected
// spelling would never become searchable.
func TestRenamingPersonReindexesSongs(t *testing.T) {
	st := testutil.NewStore(t)
	songs := seedCatalog(t, st)
	ctx := context.Background()

	var composerID uuid.UUID
	for _, c := range songs["sea"].Credits {
		if c.Role == store.CreditComposer {
			composerID = c.PersonID
		}
	}

	if _, err := st.UpdatePerson(ctx, composerID, "Mikis Theodorakis"); err != nil {
		t.Fatalf("UpdatePerson: %v", err)
	}

	got, total, err := st.ListSongs(ctx, store.SongFilter{Query: "Theodorakis"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total == 0 {
		t.Fatal("renamed person is not searchable; the denormalization trigger did not fire")
	}
	// Credits come back ordered by role, so the renamed person is not
	// necessarily first — assert on membership rather than position.
	var found bool
	for _, credit := range got[0].Credits {
		if credit.Name == "Mikis Theodorakis" {
			found = true
		}
	}
	if !found {
		t.Errorf("credits %v do not include the new name", got[0].Credits)
	}
}

// A rename leaves the slug alone so shared filter links keep working, which is
// what let a rename walk one genre onto another's name — creating two genres
// that read identically in the browse filter and the song editor, with nothing
// to say which songs were behind which. Creating cannot reach this: the slug is
// derived from the name, so two genres named alike collide there.
func TestRenamingGenreOntoAnotherIsRefused(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	rock, err := st.CreateGenre(ctx, "Rock")
	if err != nil {
		t.Fatalf("CreateGenre: %v", err)
	}
	if _, err := st.CreateGenre(ctx, "Ρεμπέτικο"); err != nil {
		t.Fatalf("CreateGenre: %v", err)
	}

	_, err = st.UpdateGenre(ctx, rock.ID, "Ρεμπέτικο")
	if err == nil {
		t.Fatal("renamed a genre onto a name another genre already holds")
	}
	if !store.IsConflict(err) {
		t.Errorf("UpdateGenre error = %v, want a conflict the handler can answer 409 with", err)
	}
}

// The upsert is what stops two contributors typing the same artist from
// fragmenting that artist's catalog across duplicate rows.
func TestUpsertPersonDeduplicates(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	first, err := st.UpsertPerson(ctx, "Μάνος Χατζιδάκις")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}

	for _, variant := range []string{"Μάνος Χατζιδάκις", "μανος χατζιδακις", "  Μάνος Χατζιδάκις  "} {
		again, err := st.UpsertPerson(ctx, variant)
		if err != nil {
			t.Fatalf("UpsertPerson(%q): %v", variant, err)
		}
		if again.ID != first.ID {
			t.Errorf("UpsertPerson(%q) created a duplicate record", variant)
		}
	}
}

// Deleting a person who is still credited must report "in use", not "not found".
//
// Both cases arrive as the same PostgreSQL foreign key violation, and only the
// statement that issued it can tell them apart: on an insert the code means a
// referenced row is missing, on this RESTRICT-ed delete it means the referencing
// credits remain. Conflating the two told the caller the person did not exist.
func TestDeleteCreditedPersonReportsInUse(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	person, err := st.UpsertPerson(ctx, "Σταύρος Ξαρχάκος")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}
	if _, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Credited Song",
		Lyrics:   "body",
		Language: "el",
		Credits:  []store.Credit{{PersonID: person.ID, Role: store.CreditComposer}},
	}, uuid.Nil); err != nil {
		t.Fatalf("CreateSong: %v", err)
	}

	err = st.DeletePerson(ctx, person.ID)
	if !store.IsInUse(err) {
		t.Errorf("deleting a credited person: got %v, want an in-use error", err)
	}
	if store.IsNotFound(err) {
		t.Errorf("a still-credited person must not be reported as missing: %v", err)
	}

	// The neighbouring classifications must not have been disturbed.
	free, err := st.UpsertPerson(ctx, "Uncredited Person")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}
	if err := st.DeletePerson(ctx, free.ID); err != nil {
		t.Errorf("deleting an uncredited person: got %v, want success", err)
	}
	if err := st.DeletePerson(ctx, uuid.New()); !store.IsNotFound(err) {
		t.Errorf("deleting a person who never existed: got %v, want not-found", err)
	}
}

func TestSongCRUD(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	author := seedUser(t, st, "author@example.com", store.RoleContributor)

	person, err := st.UpsertPerson(ctx, "Νίκος Γκάτσος")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}

	singer, err := st.UpsertPerson(ctx, "Χάρις Αλεξίου")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}

	created, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Χάρτινο το Φεγγαράκι",
		Lyrics:   "Θα φύγω",
		Language: "el",
		Credits:  []store.Credit{{PersonID: person.ID, Role: store.CreditLyricist}},
		Recordings: []store.RecordingInput{{
			ReleaseYear:    ptr(1957),
			YouTubeURL:     ptr("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
			YouTubeVideoID: ptr("dQw4w9WgXcQ"),
			IsFirst:        true,
			Performers:     []store.RecordingPerformer{{PersonID: singer.ID}},
		}},
	}, author.ID)
	if err != nil {
		t.Fatalf("CreateSong: %v", err)
	}
	if created.CreatedBy == nil || *created.CreatedBy != author.ID {
		t.Error("created_by was not recorded")
	}
	// The song's three columns are the trigger's copy of that recording, and
	// nothing in the input named them.
	if created.ReleaseYear == nil || *created.ReleaseYear != 1957 {
		t.Errorf("release_year = %v, want the recording's 1957", created.ReleaseYear)
	}
	if created.YouTubeVideoID == nil || *created.YouTubeVideoID != "dQw4w9WgXcQ" {
		t.Errorf("youtube_video_id = %v, want the recording's", created.YouTubeVideoID)
	}

	updated, err := st.UpdateSong(ctx, created.ID, store.SongInput{
		Title:      "Χάρτινο το Φεγγαράκι",
		Lyrics:     "Θα φύγω και θα γυρίσω",
		Language:   "el",
		Credits:    []store.Credit{},           // credits are replaced wholesale
		Recordings: []store.RecordingInput{{}}, // and so are recordings
	}, author.ID)
	if err != nil {
		t.Fatalf("UpdateSong: %v", err)
	}
	if len(updated.Credits) != 0 {
		t.Errorf("credits = %v, want them cleared", updated.Credits)
	}
	if len(updated.Recordings) != 1 || len(updated.Recordings[0].Performers) != 0 {
		t.Errorf("recordings = %v, want one with no performers", updated.Recordings)
	}
	// An empty recording carries no year and no link, so the copies follow it
	// down to NULL rather than keeping the values of the one it replaced.
	if updated.ReleaseYear != nil || updated.YouTubeURL != nil || updated.YouTubeVideoID != nil {
		t.Errorf("song still holds year=%v url=%v id=%v after the recording lost them",
			updated.ReleaseYear, updated.YouTubeURL, updated.YouTubeVideoID)
	}

	// Clearing the credits must also clear them from the search index. Both
	// kinds: the lyricist by credit, the singer by performance.
	for _, name := range []string{"Γκάτσος", "Αλεξίου"} {
		_, total, err := st.ListSongs(ctx, store.SongFilter{Query: name})
		if err != nil {
			t.Fatalf("ListSongs: %v", err)
		}
		if total != 0 {
			t.Errorf("removed %q is still searchable", name)
		}
	}

	// Dropping the last recording takes the year and the link with it.
	cleared, err := st.UpdateSong(ctx, created.ID, store.SongInput{
		Title:    "Χάρτινο το Φεγγαράκι",
		Lyrics:   "Θα φύγω και θα γυρίσω",
		Language: "el",
	}, author.ID)
	if err != nil {
		t.Fatalf("UpdateSong: %v", err)
	}
	if len(cleared.Recordings) != 0 {
		t.Errorf("recordings = %v, want them cleared", cleared.Recordings)
	}

	if err := st.DeleteSong(ctx, created.ID); err != nil {
		t.Fatalf("DeleteSong: %v", err)
	}
	if _, err := st.GetSong(ctx, created.ID); !store.IsNotFound(err) {
		t.Errorf("GetSong after delete: %v, want ErrNotFound", err)
	}
}

func TestPagination(t *testing.T) {
	st := testutil.NewStore(t)
	seedCatalog(t, st)
	ctx := context.Background()

	page1, total, err := st.ListSongs(ctx, store.SongFilter{Sort: store.SortTitle, Limit: 2, Offset: 0})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total != 3 {
		t.Fatalf("total = %d, want 3", total)
	}
	if len(page1) != 2 {
		t.Fatalf("page 1 length = %d, want 2", len(page1))
	}

	page2, _, err := st.ListSongs(ctx, store.SongFilter{Sort: store.SortTitle, Limit: 2, Offset: 2})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if len(page2) != 1 {
		t.Fatalf("page 2 length = %d, want 1", len(page2))
	}

	// Pages must not overlap, which requires a total ordering — the title sort
	// alone is not unique, so it is tie-broken by id.
	for _, a := range page1 {
		if a.ID == page2[0].ID {
			t.Errorf("song %q appears on both pages", a.Title)
		}
	}
}

// An explicit sort has to survive relevance mode. Search took a different code
// path that never consulted the requested ordering, so picking "Title (A–Z)"
// with a query in the box changed nothing at all — the control moved, the
// request carried the parameter, and the same relevance-ranked page came back.
func TestSearchHonorsExplicitSort(t *testing.T) {
	st := testutil.NewStore(t)
	seedCatalog(t, st)
	ctx := context.Background()

	// Both Greek songs mention the sea, but only one has it in the title — so
	// relevance ranks that one first while newest-first ranks it last. The two
	// orderings disagree, which is what makes the sort observable at all.
	relevance, _, err := st.ListSongs(ctx, store.SongFilter{Query: "θαλασσα", Limit: 10})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if got, want := titles(relevance), []string{"Θάλασσα Πλατιά", "Το Τραγούδι της Αγάπης"}; !equal(got, want) {
		t.Fatalf("relevance order = %v, want %v", got, want)
	}

	newest, _, err := st.ListSongs(ctx, store.SongFilter{
		Query: "θαλασσα", Sort: store.SortNewest, Limit: 10,
	})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if got, want := titles(newest), []string{"Το Τραγούδι της Αγάπης", "Θάλασσα Πλατιά"}; !equal(got, want) {
		t.Errorf("newest-first order = %v, want %v", got, want)
	}

	// Snippets are what relevance mode adds, and reordering must not cost them.
	if newest[0].Snippet == nil {
		t.Error("search result lost its snippet when an explicit sort was applied")
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ts_headline returns the source text verbatim rather than escaping it, so
// markup in the lyrics reaches the snippet unchanged. The delimiters must
// therefore not be HTML: if they were, a client rendering the snippet as
// markup would execute whatever a contributor put in the lyrics.
func TestSnippetDelimitersAreNotMarkup(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	_, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Injection Attempt",
		Lyrics:   `innocent <img src=x onerror=alert(1)> θάλασσα here`,
		Language: "el",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("CreateSong: %v", err)
	}

	songs, _, err := st.ListSongs(ctx, store.SongFilter{Query: "θάλασσα"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if len(songs) == 0 || songs[0].Snippet == nil {
		t.Fatal("expected a snippet")
	}

	if !strings.Contains(*songs[0].Snippet, store.SnippetStartSel) {
		t.Fatalf("snippet %q is not highlighted", *songs[0].Snippet)
	}
	// The delimiters must not be tags, so a client never has to decide which
	// of the tags in this string are the safe ones.
	if strings.ContainsAny(store.SnippetStartSel+store.SnippetStopSel, "<>&") {
		t.Error("highlight delimiters must not be HTML")
	}
}

// Listings must not carry the lyrics body.
//
// No screen that shows more than one song renders it, and it outweighs
// everything else in a page of twenty several times over — the list page paid
// that cost on every removal, refetching every remaining song in full to redraw
// a row of titles. Search is the shape to keep in view: it ships a ts_headline
// excerpt precisely so the body does not have to travel.
//
// Absent is not blank. A song may genuinely have no lyrics recorded, so the
// summary leaves nil and only a single-song read fills the field in — a
// projection that returned "" instead would be indistinguishable from a song
// whose lyrics nobody has typed yet.
func TestListingsOmitLyricsAndSingleReadsKeepThem(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	owner := seedUser(t, st, "curator@example.com", store.RoleUser)

	singer, err := st.UpsertPerson(ctx, "Χάρις Αλεξίου")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}

	const body = "Θα φύγω και θα γυρίσω"
	created, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Χάρτινο το Φεγγαράκι",
		Lyrics:   body,
		Language: "el",
		Recordings: []store.RecordingInput{{
			IsFirst:    true,
			Performers: []store.RecordingPerformer{{PersonID: singer.ID}},
		}},
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("CreateSong: %v", err)
	}

	// Recordings are the counter-case to the lyrics: they are on every read, so
	// a listing can render the performer under a title and the card can say
	// whether there is a video. Only the body is projected away.
	hasPerformer := func(what string, s store.Song) {
		t.Helper()
		if len(s.Recordings) != 1 {
			t.Errorf("%s recordings = %v, want one", what, s.Recordings)
			return
		}
		if len(s.Recordings[0].Performers) != 1 {
			t.Errorf("%s performers = %v, want one", what, s.Recordings[0].Performers)
			return
		}
		if s.Recordings[0].Performers[0].Name != "Χάρις Αλεξίου" {
			t.Errorf("%s performer = %q, want the name filled in",
				what, s.Recordings[0].Performers[0].Name)
		}
	}
	hasPerformer("CreateSong", *created)
	// Create answers through GetSong, so this is the single-song read as well
	// as the write — the client caches it as the song and would blank the
	// detail page if it arrived without a body.
	if created.Lyrics == nil || *created.Lyrics != body {
		t.Errorf("CreateSong lyrics = %v, want the body", created.Lyrics)
	}

	full, err := st.GetSong(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetSong: %v", err)
	}
	if full.Lyrics == nil || *full.Lyrics != body {
		t.Errorf("GetSong lyrics = %v, want the body", full.Lyrics)
	}
	hasPerformer("GetSong", *full)

	browsed, _, err := st.ListSongs(ctx, store.SongFilter{})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if len(browsed) == 0 {
		t.Fatal("expected the song in the browse listing")
	}
	if browsed[0].Lyrics != nil {
		t.Errorf("browse lyrics = %q, want them projected away", *browsed[0].Lyrics)
	}
	hasPerformer("browse", browsed[0])

	// Search drops the body too, and the snippet is what replaces it.
	found, _, err := st.ListSongs(ctx, store.SongFilter{Query: "φύγω"})
	if err != nil {
		t.Fatalf("ListSongs (search): %v", err)
	}
	if len(found) == 0 {
		t.Fatal("expected a search hit")
	}
	if found[0].Lyrics != nil {
		t.Errorf("search lyrics = %q, want them projected away", *found[0].Lyrics)
	}
	if found[0].Snippet == nil {
		t.Error("search dropped the body without offering a snippet")
	}

	list, err := st.CreateList(ctx, owner.ID, "Αγαπημένα", nil, false)
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	if err := st.AddSongToList(ctx, list.ID, created.ID); err != nil {
		t.Fatalf("AddSongToList: %v", err)
	}
	inList, err := st.SongsInList(ctx, list.ID)
	if err != nil {
		t.Fatalf("SongsInList: %v", err)
	}
	if len(inList) != 1 {
		t.Fatalf("SongsInList returned %d songs, want 1", len(inList))
	}
	if inList[0].Lyrics != nil {
		t.Errorf("list lyrics = %q, want them projected away", *inList[0].Lyrics)
	}
	hasPerformer("SongsInList", inList[0])
}

// The ordering of a song's recordings is the API's answer to "which one is
// first", and the same rule decides which one's year and link get copied onto
// the song. Two SQL sites carry it — the ORDER BY in attachRelations and the one
// inside refresh_songs_denorm — and this is what holds them to each other.
//
// The fixture is built so that every clause matters: the marked recording is not
// the earliest, the earliest year is not first in insertion order, and one
// recording has no year at all so NULLS LAST is exercised.
func TestFirstRecordingRuleHasOneAuthority(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	created, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Πολλές Εκτελέσεις",
		Lyrics:   "στίχοι",
		Language: "el",
		Recordings: []store.RecordingInput{
			{Label: ptr("no year"), Position: 0},
			{Label: ptr("earliest"), ReleaseYear: ptr(1950), Position: 1},
			{Label: ptr("marked"), ReleaseYear: ptr(1988), IsFirst: true, Position: 2},
		},
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("CreateSong: %v", err)
	}

	labels := make([]string, len(created.Recordings))
	for i, r := range created.Recordings {
		labels[i] = *r.Label
	}
	want := []string{"marked", "earliest", "no year"}
	if len(labels) != len(want) {
		t.Fatalf("recordings = %v, want %v", labels, want)
	}
	for i := range want {
		if labels[i] != want[i] {
			t.Fatalf("recordings = %v, want %v", labels, want)
		}
	}

	// And the song's copy is that same first recording's, not another's.
	if created.ReleaseYear == nil || *created.ReleaseYear != 1988 {
		t.Errorf("song release_year = %v, want the first recording's 1988", created.ReleaseYear)
	}

	// Unmarking it hands first place to the earliest year, and the song's copy
	// has to move with it — which is the disagreement the mirror can produce.
	in := store.SongInput{
		Title:    "Πολλές Εκτελέσεις",
		Lyrics:   "στίχοι",
		Language: "el",
		Recordings: []store.RecordingInput{
			{Label: ptr("no year"), Position: 0},
			{Label: ptr("earliest"), ReleaseYear: ptr(1950), Position: 1},
			{Label: ptr("was marked"), ReleaseYear: ptr(1988), Position: 2},
		},
	}
	updated, err := st.UpdateSong(ctx, created.ID, in, uuid.Nil)
	if err != nil {
		t.Fatalf("UpdateSong: %v", err)
	}
	if *updated.Recordings[0].Label != "earliest" {
		t.Errorf("first recording = %q, want the earliest year to lead", *updated.Recordings[0].Label)
	}
	if updated.ReleaseYear == nil || *updated.ReleaseYear != 1950 {
		t.Errorf("song release_year = %v, want 1950 — the copy did not follow the reordering",
			updated.ReleaseYear)
	}
}

// Two recordings claiming to be the first is refused by the schema. The API
// answers 422 before reaching here; this is the backstop under it, and what
// makes "at most one" a property of the data rather than of one code path.
func TestSecondFirstRecordingIsRefused(t *testing.T) {
	st := testutil.NewStore(t)

	_, err := st.CreateSong(context.Background(), store.SongInput{
		Title:    "Δύο Πρώτες",
		Lyrics:   "στίχοι",
		Language: "el",
		Recordings: []store.RecordingInput{
			{Label: ptr("one"), IsFirst: true},
			{Label: ptr("two"), IsFirst: true},
		},
	}, uuid.Nil)
	if err == nil {
		t.Fatal("CreateSong accepted two first recordings")
	}
	if !store.IsConflict(err) {
		t.Errorf("CreateSong error = %v, want a conflict", err)
	}
}

// A person reached only through a recording must be as findable as one credited
// on the song, because the song page links every name it shows to ?person=.
func TestPersonFilterMatchesRecordingPerformers(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	songs := seedCatalog(t, st)

	performerID := songs["sea"].Recordings[0].Performers[0].PersonID

	for _, tc := range []struct {
		what   string
		filter store.SongFilter
	}{
		{"person, any capacity", store.SongFilter{PersonID: &performerID}},
		{"performer", store.SongFilter{PerformerID: &performerID}},
	} {
		t.Run(tc.what, func(t *testing.T) {
			got, total, err := st.ListSongs(ctx, tc.filter)
			if err != nil {
				t.Fatalf("ListSongs: %v", err)
			}
			if total != 1 {
				t.Fatalf("total = %d, want 1 (got %v)", total, titles(got))
			}
			if got[0].ID != songs["sea"].ID {
				t.Errorf("got %q, want %q", got[0].Title, songs["sea"].Title)
			}
		})
	}
}

// A person's song count spans both ways of being attached to a song, and counts
// each song once. "arms" is written and performed by the same person, which is
// the case a UNION gets right and a sum of two counts does not.
func TestPeopleSongCountIncludesPerformances(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	seedCatalog(t, st)

	for _, tc := range []struct {
		name string
		want int
	}{
		{"Γιώργος Νταλάρας", 1}, // performer only
		{"Nick Cave", 1},        // composer and performer of the same song
		{"Μίκης Θεοδωράκης", 2}, // credited on two songs
	} {
		people, _, err := st.ListPeople(ctx, store.PersonFilter{Query: tc.name})
		if err != nil {
			t.Fatalf("ListPeople(%q): %v", tc.name, err)
		}
		if len(people) == 0 {
			t.Fatalf("ListPeople(%q) found nobody", tc.name)
		}
		if people[0].SongCount != tc.want {
			t.Errorf("%s song_count = %d, want %d", tc.name, people[0].SongCount, tc.want)
		}
	}
}

// A renamed performer must become searchable under the new spelling, which
// needs the person-rename trigger to reach songs through recordings as well as
// through credits. Left reading song_credits alone this is silent: the rename
// succeeds and the song simply stops matching either spelling.
func TestRenamingPerformerReindexesSongs(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	songs := seedCatalog(t, st)

	performerID := songs["sea"].Recordings[0].Performers[0].PersonID
	if _, err := st.UpdatePerson(ctx, performerID, "Γιώργος Νταλάράς"); err != nil {
		t.Fatalf("UpdatePerson: %v", err)
	}

	_, total, err := st.ListSongs(ctx, store.SongFilter{Query: "Νταλάράς"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total != 1 {
		t.Errorf("total = %d, want the renamed performer to be searchable", total)
	}
}

// Deleting someone who only ever performed must fail like deleting a credited
// person does — the RESTRICT is on both references, and the classification the
// callers rely on has to hold for the new one too.
func TestDeletePerformerReportsInUse(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()
	songs := seedCatalog(t, st)

	performerID := songs["sea"].Recordings[0].Performers[0].PersonID
	err := st.DeletePerson(ctx, performerID)
	if !store.IsInUse(err) {
		t.Errorf("DeletePerson = %v, want ErrInUse", err)
	}
}
