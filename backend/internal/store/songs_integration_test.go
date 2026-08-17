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
		{"sea", store.SongInput{
			Title:    "Θάλασσα Πλατιά",
			Lyrics:   "Στης θάλασσας τα βάθη\nη αγάπη μου κοιμάται",
			Language: "el",
			Credits: []store.Credit{
				{PersonID: theodorakis.ID, Role: store.CreditComposer},
				{PersonID: dalaras.ID, Role: store.CreditArtist},
			},
			GenreIDs: []uuid.UUID{entechno.ID},
		}},
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
		{"arms", store.SongInput{
			Title:    "Into My Arms",
			Lyrics:   "I do not believe in an interventionist God\nBut I know darling that you do",
			Language: "en",
			Credits: []store.Credit{
				{PersonID: cave.ID, Role: store.CreditArtist},
			},
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
func TestFuzzyArtistMatchSurvivesManyCredits(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	target, err := st.UpsertPerson(ctx, "Μίκης Θεοδωράκης")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}

	credits := []store.Credit{{PersonID: target.ID, Role: store.CreditComposer}}
	for _, name := range []string{
		"Γιώργος Νταλάρας", "Χάρις Αλεξίου", "Νίκος Γκάτσος", "Μάνος Χατζιδάκις",
	} {
		person, err := st.UpsertPerson(ctx, name)
		if err != nil {
			t.Fatalf("UpsertPerson(%q): %v", name, err)
		}
		credits = append(credits, store.Credit{PersonID: person.ID, Role: store.CreditPerformer})
	}

	if _, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Πολλοί Συντελεστές",
		Lyrics:   "στίχοι",
		Language: "el",
		Credits:  credits,
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

// A person credited in two capacities must appear once in the denormalized
// field, not once per credit.
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
			{PersonID: person.ID, Role: store.CreditArtist},
			{PersonID: person.ID, Role: store.CreditLyricist},
		},
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
	var composerID, artistID uuid.UUID
	for _, c := range sea.Credits {
		switch c.Role {
		case store.CreditComposer:
			composerID = c.PersonID
		case store.CreditArtist:
			artistID = c.PersonID
		}
	}
	if composerID == uuid.Nil || artistID == uuid.Nil {
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

	// Two credit filters must intersect. A naive JOIN would multiply rows and
	// return songs matching either one.
	t.Run("two credit filters intersect", func(t *testing.T) {
		got, total, err := st.ListSongs(ctx, store.SongFilter{
			ComposerID: &composerID,
			ArtistID:   &artistID,
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
			ArtistID:   &artistID,
			LyricistID: &lyricistID,
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

	created, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Χάρτινο το Φεγγαράκι",
		Lyrics:   "Θα φύγω",
		Language: "el",
		Credits:  []store.Credit{{PersonID: person.ID, Role: store.CreditLyricist}},
	}, author.ID)
	if err != nil {
		t.Fatalf("CreateSong: %v", err)
	}
	if created.CreatedBy == nil || *created.CreatedBy != author.ID {
		t.Error("created_by was not recorded")
	}

	updated, err := st.UpdateSong(ctx, created.ID, store.SongInput{
		Title:    "Χάρτινο το Φεγγαράκι",
		Lyrics:   "Θα φύγω και θα γυρίσω",
		Language: "el",
		Credits:  []store.Credit{}, // credits are replaced wholesale
	}, author.ID)
	if err != nil {
		t.Fatalf("UpdateSong: %v", err)
	}
	if len(updated.Credits) != 0 {
		t.Errorf("credits = %v, want them cleared", updated.Credits)
	}

	// Clearing the credits must also clear them from the search index.
	_, total, err := st.ListSongs(ctx, store.SongFilter{Query: "Γκάτσος"})
	if err != nil {
		t.Fatalf("ListSongs: %v", err)
	}
	if total != 0 {
		t.Error("removed credit is still searchable")
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

	const body = "Θα φύγω και θα γυρίσω"
	created, err := st.CreateSong(ctx, store.SongInput{
		Title:    "Χάρτινο το Φεγγαράκι",
		Lyrics:   body,
		Language: "el",
	}, uuid.Nil)
	if err != nil {
		t.Fatalf("CreateSong: %v", err)
	}
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
}
