package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/store"
	"github.com/christos/lyrics/backend/internal/testutil"
)

// One record shaped like the old export: an authorship credit, a performer
// arriving as an "artist" credit, a genre, and a record-level link and year
// that the importer folds into a synthesized first recording.
const baseRecord = `{"source_id":"1","title":"Το τραγούδι της αγάπης","lyrics":"στίχοι","language":"el",` +
	`"youtube_url":"https://youtu.be/dQw4w9WgXcQ","release_year":1964,` +
	`"credits":[{"name":"Μάνος Χατζιδάκις","role":"composer"},{"name":"Νανά Μούσχουρη","role":"artist"}],` +
	`"genres":["Έντεχνο"]}`

// importLines writes the records to an NDJSON file and runs the importer over
// it exactly as the command does, from load through commit.
func importLines(t *testing.T, st *store.Store, opt options, lines ...string) error {
	t.Helper()

	path := filepath.Join(t.TempDir(), "songs.ndjson")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatalf("write input: %v", err)
	}
	songs, _, err := load(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	return importAll(context.Background(), st.Pool(), songs, opt)
}

func count(t *testing.T, st *store.Store, query string, args ...any) int {
	t.Helper()

	var n int
	if err := st.Pool().QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func TestImportWritesSongWithRelations(t *testing.T) {
	st := testutil.NewStore(t)

	if err := importLines(t, st, options{}, baseRecord); err != nil {
		t.Fatalf("import: %v", err)
	}

	// QueryRow alone would silently pick one of several rows.
	if n := count(t, st, `SELECT count(*) FROM songs`); n != 1 {
		t.Fatalf("songs = %d, want 1", n)
	}
	var id uuid.UUID
	if err := st.Pool().QueryRow(context.Background(), `SELECT id FROM songs`).Scan(&id); err != nil {
		t.Fatalf("read the one imported song: %v", err)
	}
	song, err := st.GetSong(context.Background(), id)
	if err != nil {
		t.Fatalf("GetSong: %v", err)
	}

	if len(song.Credits) != 1 || song.Credits[0].Role != store.CreditComposer {
		t.Errorf("credits = %+v, want the composer alone", song.Credits)
	}
	if len(song.Recordings) != 1 || len(song.Recordings[0].Performers) != 1 ||
		song.Recordings[0].Performers[0].Name != "Νανά Μούσχουρη" {
		t.Errorf("recordings = %+v, want one carrying the artist as performer", song.Recordings)
	}
	if len(song.Genres) != 1 {
		t.Errorf("genres = %+v, want one", song.Genres)
	}
	// Trigger-owned copies of the first recording: the importer writes none of
	// them, so finding them set proves the trigger ran on its rows.
	if song.ReleaseYear == nil || *song.ReleaseYear != 1964 {
		t.Errorf("release_year = %v, want 1964", song.ReleaseYear)
	}
	if song.YouTubeVideoID == nil || *song.YouTubeVideoID != "dQw4w9WgXcQ" {
		t.Errorf("youtube_video_id = %v, want dQw4w9WgXcQ", song.YouTubeVideoID)
	}
	if song.CreatedBy != nil {
		t.Errorf("created_by = %v, want NULL without -actor-email", song.CreatedBy)
	}
}

func TestReimportSkipsEverySong(t *testing.T) {
	st := testutil.NewStore(t)
	second := `{"source_id":"2","title":"Second","credits":[{"name":"Someone","role":"lyricist"}]}`

	for run := 1; run <= 2; run++ {
		if err := importLines(t, st, options{}, baseRecord, second); err != nil {
			t.Fatalf("import run %d: %v", run, err)
		}
	}
	if n := count(t, st, `SELECT count(*) FROM songs`); n != 2 {
		t.Errorf("songs after re-import = %d, want 2", n)
	}
}

// The migration created recordings through the schema, not through this
// importer, so the fingerprint read back from the database has to count
// performers the same way (*song).fingerprint does or every re-import of the
// export duplicates the catalog.
func TestImportRecognizesSongsWhosePerformersAreOnRecordings(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	composer, err := st.UpsertPerson(ctx, "Μάνος Χατζιδάκις")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}
	singer, err := st.UpsertPerson(ctx, "Νανά Μούσχουρη")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}
	if _, err := st.CreateSong(ctx, store.SongInput{
		Title: "Το τραγούδι της αγάπης", Lyrics: "στίχοι", Language: "el",
		Credits: []store.Credit{{PersonID: composer.ID, Role: store.CreditComposer}},
		Recordings: []store.RecordingInput{{
			IsFirst:    true,
			Performers: []store.RecordingPerformer{{PersonID: singer.ID}},
		}},
	}, uuid.Nil); err != nil {
		t.Fatalf("CreateSong: %v", err)
	}

	if err := importLines(t, st, options{}, baseRecord); err != nil {
		t.Fatalf("import: %v", err)
	}
	if n := count(t, st, `SELECT count(*) FROM songs`); n != 1 {
		t.Errorf("songs = %d, want 1: the stored song was not recognized", n)
	}
}

func TestImportDeduplicatesWithinInput(t *testing.T) {
	t.Run("the same song twice in one file is inserted once", func(t *testing.T) {
		st := testutil.NewStore(t)
		if err := importLines(t, st, options{}, baseRecord, baseRecord); err != nil {
			t.Fatalf("import: %v", err)
		}
		if n := count(t, st, `SELECT count(*) FROM songs`); n != 1 {
			t.Errorf("songs = %d, want 1", n)
		}
	})

	t.Run("-allow-duplicates inserts every copy", func(t *testing.T) {
		st := testutil.NewStore(t)
		if err := importLines(t, st, options{duplicates: true}, baseRecord, baseRecord); err != nil {
			t.Fatalf("import: %v", err)
		}
		if n := count(t, st, `SELECT count(*) FROM songs`); n != 2 {
			t.Errorf("songs = %d, want 2", n)
		}
	})
}

func TestImportConvergesPeopleAndKeepsCuratedGenres(t *testing.T) {
	st := testutil.NewStore(t)
	ctx := context.Background()

	curated, err := st.CreateGenre(ctx, "Έντεχνο")
	if err != nil {
		t.Fatalf("CreateGenre: %v", err)
	}
	// The accented spelling exists only in the database. Were it also in the
	// input, the second spelling would converge in the importer's own cache
	// (foldKey) and never reach the ON CONFLICT (normalized_name) path.
	composer, err := st.UpsertPerson(ctx, "Μάνος Χατζιδάκις")
	if err != nil {
		t.Fatalf("UpsertPerson: %v", err)
	}

	// The composer without accents and in capitals, and the genre in capitals:
	// each folds onto the existing row.
	if err := importLines(t, st, options{},
		`{"title":"One","credits":[{"name":"Μανος Χατζιδακις","role":"composer"}],"genres":["ΕΝΤΕΧΝΟ"]}`,
		`{"title":"Two","credits":[{"name":"ΜΑΝΟΣ ΧΑΤΖΙΔΑΚΙΣ","role":"composer"}],"genres":["Έντεχνο"]}`,
	); err != nil {
		t.Fatalf("import: %v", err)
	}

	if n := count(t, st, `SELECT count(*) FROM people`); n != 1 {
		t.Errorf("people = %d, want 1", n)
	}
	if n := count(t, st, `SELECT count(*) FROM song_credits WHERE person_id = $1`, composer.ID); n != 2 {
		t.Errorf("songs credited to the existing composer = %d, want 2", n)
	}
	if got, err := st.GetPerson(ctx, composer.ID); err != nil || got.Name != composer.Name {
		t.Errorf("composer = %+v (%v), want the stored spelling %q kept", got, err, composer.Name)
	}
	genres, err := st.ListGenres(ctx)
	if err != nil {
		t.Fatalf("ListGenres: %v", err)
	}
	if len(genres) != 1 || genres[0].ID != curated.ID || genres[0].Name != "Έντεχνο" {
		t.Errorf("genres = %+v, want only the curated %q", genres, "Έντεχνο")
	}
	if n := count(t, st, `SELECT count(*) FROM song_genres WHERE genre_id = $1`, curated.ID); n != 2 {
		t.Errorf("songs in the curated genre = %d, want 2", n)
	}
}

func TestImportActor(t *testing.T) {
	t.Run("a known address is recorded as creator and updater", func(t *testing.T) {
		st := testutil.NewStore(t)
		user, err := st.ProvisionUser(context.Background(), "usr_importer", "importer@example.com", store.RoleAdmin)
		if err != nil {
			t.Fatalf("ProvisionUser: %v", err)
		}

		// Matched case-insensitively and trimmed, as typed on a command line.
		if err := importLines(t, st, options{actorEmail: "  Importer@Example.com "}, baseRecord); err != nil {
			t.Fatalf("import: %v", err)
		}
		if n := count(t, st, `SELECT count(*) FROM songs WHERE created_by = $1 AND updated_by = $1`, user.ID); n != 1 {
			t.Errorf("songs attributed to the actor = %d, want 1", n)
		}
	})

	t.Run("an unknown address aborts before writing anything", func(t *testing.T) {
		st := testutil.NewStore(t)

		err := importLines(t, st, options{actorEmail: "typo@example.com"}, baseRecord)
		if err == nil || !strings.Contains(err.Error(), "typo@example.com") {
			t.Fatalf("err = %v, want one naming the unknown address", err)
		}
		if n := count(t, st, `SELECT count(*) FROM songs`); n != 0 {
			t.Errorf("songs = %d, want 0", n)
		}
	})
}
