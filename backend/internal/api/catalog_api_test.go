package api_test

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/store"
)

func TestAdminManagesPeople(t *testing.T) {
	h := newHarness(t)
	adminTok := h.tokenFor("admin@example.com", store.RoleAdmin)

	person := func(name string) *store.Person {
		t.Helper()
		p, err := h.store.UpsertPerson(t.Context(), name)
		if err != nil {
			t.Fatalf("UpsertPerson(%q): %v", name, err)
		}
		return p
	}
	path := func(p *store.Person) string { return "/api/v1/people/" + p.ID.String() }

	t.Run("read", func(t *testing.T) {
		p := person("Μάνος Χατζιδάκις")

		resp := h.do("GET", path(p), "", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if got := decode[store.Person](t, resp); got.Name != p.Name {
			t.Errorf("name = %q, want %q", got.Name, p.Name)
		}
		if resp := h.do("GET", "/api/v1/people/"+uuid.NewString(), "", nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("unknown id = %d, want 404", resp.StatusCode)
		}
		if resp := h.do("GET", "/api/v1/people/not-an-id", "", nil); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("malformed id = %d, want 400", resp.StatusCode)
		}
	})

	t.Run("rename", func(t *testing.T) {
		p := person("Misspeled Name")
		taken := person("Taken Name")

		resp := h.do("PATCH", path(p), adminTok, map[string]any{"name": "  Corrected Name  "})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if got := decode[store.Person](t, resp); got.Name != "Corrected Name" {
			t.Errorf("name = %q, want the trimmed new name", got.Name)
		}

		if resp := h.do("PATCH", path(p), adminTok, map[string]any{"name": taken.Name}); resp.StatusCode != http.StatusConflict {
			t.Errorf("rename onto another person = %d, want 409", resp.StatusCode)
		}
		if resp := h.do("PATCH", path(p), adminTok, map[string]any{"name": "   "}); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("blank name = %d, want 422", resp.StatusCode)
		}
		if resp := h.do("PATCH", "/api/v1/people/"+uuid.NewString(), adminTok, map[string]any{"name": "Anyone"}); resp.StatusCode != http.StatusNotFound {
			t.Errorf("unknown id = %d, want 404", resp.StatusCode)
		}
	})

	// recording_credits restricts deletes like song_credits does, so a person
	// known only as a performer is just as undeletable as a composer.
	t.Run("delete is refused while credited or performing", func(t *testing.T) {
		composer := person("Credited Composer")
		singer := person("Performing Singer")
		if _, err := h.store.CreateSong(t.Context(), store.SongInput{
			Title: "Guarded", Lyrics: "words", Language: "el",
			Credits:    []store.Credit{{PersonID: composer.ID, Role: store.CreditComposer}},
			Recordings: []store.RecordingInput{{Performers: []store.RecordingPerformer{{PersonID: singer.ID}}}},
		}, uuid.Nil); err != nil {
			t.Fatalf("CreateSong: %v", err)
		}

		for _, p := range []*store.Person{composer, singer} {
			if resp := h.do("DELETE", path(p), adminTok, nil); resp.StatusCode != http.StatusConflict {
				t.Errorf("delete %q = %d, want 409", p.Name, resp.StatusCode)
			}
		}
	})

	t.Run("delete removes an uncredited person", func(t *testing.T) {
		p := person("Nobody In Particular")

		if resp := h.do("DELETE", path(p), adminTok, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.StatusCode)
		}
		if resp := h.do("GET", path(p), "", nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("read after delete = %d, want 404", resp.StatusCode)
		}
		if resp := h.do("DELETE", path(p), adminTok, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("second delete = %d, want 404", resp.StatusCode)
		}
	})
}

func TestGenreLifecycle(t *testing.T) {
	h := newHarness(t)
	contribTok := h.tokenFor("contrib@example.com", store.RoleContributor)
	adminTok := h.tokenFor("admin@example.com", store.RoleAdmin)

	resp := h.do("POST", "/api/v1/genres", contribTok, map[string]any{"name": "Λαϊκό"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", resp.StatusCode)
	}
	genre := decode[store.Genre](t, resp)
	path := "/api/v1/genres/" + genre.ID.String()

	t.Run("create refuses a duplicate and a name with no letters", func(t *testing.T) {
		if resp := h.do("POST", "/api/v1/genres", contribTok, map[string]any{"name": "Λαϊκό"}); resp.StatusCode != http.StatusConflict {
			t.Errorf("duplicate = %d, want 409", resp.StatusCode)
		}
		if resp := h.do("POST", "/api/v1/genres", contribTok, map[string]any{"name": "!!!"}); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("punctuation only = %d, want 422", resp.StatusCode)
		}
	})

	// The slug stays put so bookmarked filter links keep working.
	t.Run("rename keeps the slug", func(t *testing.T) {
		resp := h.do("PATCH", path, adminTok, map[string]any{"name": "Λαϊκό τραγούδι"})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		got := decode[store.Genre](t, resp)
		if got.Name != "Λαϊκό τραγούδι" || got.Slug != genre.Slug {
			t.Errorf("got %q/%q, want the new name under slug %q", got.Name, got.Slug, genre.Slug)
		}

		other, err := h.store.CreateGenre(t.Context(), "Ρεμπέτικο")
		if err != nil {
			t.Fatalf("CreateGenre: %v", err)
		}
		if resp := h.do("PATCH", path, adminTok, map[string]any{"name": other.Name}); resp.StatusCode != http.StatusConflict {
			t.Errorf("rename onto another genre = %d, want 409", resp.StatusCode)
		}
		if resp := h.do("PATCH", "/api/v1/genres/"+uuid.NewString(), adminTok, map[string]any{"name": "Anything"}); resp.StatusCode != http.StatusNotFound {
			t.Errorf("unknown id = %d, want 404", resp.StatusCode)
		}
	})

	// Unlike a person, a genre in use may be deleted: it only categorizes.
	t.Run("delete detaches it from its songs", func(t *testing.T) {
		song, err := h.store.CreateSong(t.Context(), store.SongInput{
			Title: "Tagged", Lyrics: "words", Language: "el", GenreIDs: []uuid.UUID{genre.ID},
		}, uuid.Nil)
		if err != nil {
			t.Fatalf("CreateSong: %v", err)
		}

		if resp := h.do("DELETE", path, adminTok, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.StatusCode)
		}
		got, err := h.store.GetSong(t.Context(), song.ID)
		if err != nil {
			t.Fatalf("GetSong: %v", err)
		}
		if len(got.Genres) != 0 {
			t.Errorf("song genres = %+v, want none", got.Genres)
		}
		if resp := h.do("DELETE", path, adminTok, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("second delete = %d, want 404", resp.StatusCode)
		}
	})
}

func TestDeleteList(t *testing.T) {
	h := newHarness(t)
	ownerTok := h.tokenFor("owner@example.com", store.RoleUser)
	strangerTok := h.tokenFor("stranger@example.com", store.RoleUser)

	list := h.seedList(ownerTok, map[string]any{"name": "Disposable"})
	path := "/api/v1/lists/" + list.ID.String()

	// A private list answers a stranger 404 to a write as well as a read, so
	// neither tells "exists" from "does not".
	if resp := h.do("DELETE", path, strangerTok, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stranger delete = %d, want 404", resp.StatusCode)
	}
	if resp := h.do("GET", path, strangerTok, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stranger read = %d, want 404", resp.StatusCode)
	}
	if resp := h.do("DELETE", path, ownerTok, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("owner delete = %d, want 204", resp.StatusCode)
	}
	if resp := h.do("GET", path, ownerTok, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("read after delete = %d, want 404", resp.StatusCode)
	}

	// A public list is readable by a stranger, which is exactly why being able
	// to read it must not be mistaken for being allowed to delete it.
	public := h.seedList(ownerTok, map[string]any{"name": "Shared", "is_public": true})
	publicPath := "/api/v1/lists/" + public.ID.String()
	if resp := h.do("DELETE", publicPath, strangerTok, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stranger delete of a public list = %d, want 404", resp.StatusCode)
	}
	if resp := h.do("GET", publicPath, strangerTok, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("public list after a stranger's delete = %d, want it still readable", resp.StatusCode)
	}
}

func TestAdminDeletesUser(t *testing.T) {
	h := newHarness(t)
	admin, adminTok := h.userAndToken("admin@example.com", store.RoleAdmin)

	t.Run("an account goes and its songs stay", func(t *testing.T) {
		author, authorTok := h.userAndToken("author@example.com", store.RoleContributor)
		songID := h.seedSong(author, "Outlives Its Author")
		h.seedList(authorTok, map[string]any{"name": "Goes With Them"})

		if resp := h.do("DELETE", "/api/v1/admin/users/"+author.ID.String(), adminTok, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", resp.StatusCode)
		}

		if _, err := h.store.GetUser(t.Context(), author.ID); !store.IsNotFound(err) {
			t.Errorf("GetUser after delete: err = %v, want not found", err)
		}
		song, err := h.store.GetSong(t.Context(), uuid.MustParse(songID))
		if err != nil {
			t.Fatalf("song should survive its author: %v", err)
		}
		if song.CreatedBy != nil {
			t.Errorf("created_by = %v, want NULL", song.CreatedBy)
		}
		lists, err := h.store.ListsForOwner(t.Context(), author.ID)
		if err != nil {
			t.Fatalf("ListsForOwner: %v", err)
		}
		if len(lists) != 0 {
			t.Errorf("lists = %d, want the author's lists gone with them", len(lists))
		}
	})

	t.Run("another admin may be deleted", func(t *testing.T) {
		other := h.user("second.admin@example.com", store.RoleAdmin)
		if resp := h.do("DELETE", "/api/v1/admin/users/"+other.ID.String(), adminTok, nil); resp.StatusCode != http.StatusNoContent {
			t.Errorf("status = %d, want 204", resp.StatusCode)
		}
	})

	t.Run("an admin cannot delete themselves", func(t *testing.T) {
		if resp := h.do("DELETE", "/api/v1/admin/users/"+admin.ID.String(), adminTok, nil); resp.StatusCode != http.StatusForbidden {
			t.Errorf("status = %d, want 403", resp.StatusCode)
		}
	})

	t.Run("an unknown account is not found", func(t *testing.T) {
		if resp := h.do("DELETE", "/api/v1/admin/users/"+uuid.NewString(), adminTok, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("status = %d, want 404", resp.StatusCode)
		}
	})
}
