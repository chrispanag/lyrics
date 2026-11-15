package api_test

import (
	"net/http"
	"testing"

	"github.com/christos/lyrics/backend/internal/store"
)

// A song answers permanently at its slug and its UUID; an unknown address is
// 404, not 400. See CLAUDE.md "Song addresses".
func TestASongAnswersAtItsSlugAndItsID(t *testing.T) {
	h := newHarness(t)
	_, token := h.userAndToken("contrib@example.com", store.RoleContributor)

	resp := h.do("POST", "/api/v1/songs", token, map[string]any{
		"title":    "Θάλασσα Πλατιά",
		"language": "el",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", resp.StatusCode)
	}
	created := decode[store.Song](t, resp)

	if created.Slug != "thalassa-platia" {
		t.Fatalf("slug = %q, want the title transliterated", created.Slug)
	}

	t.Run("by slug", func(t *testing.T) {
		resp := h.do("GET", "/api/v1/songs/"+created.Slug, "", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if got := decode[store.Song](t, resp); got.ID != created.ID {
			t.Errorf("id = %s, want %s", got.ID, created.ID)
		}
	})

	t.Run("by id", func(t *testing.T) {
		resp := h.do("GET", "/api/v1/songs/"+created.ID.String(), "", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if got := decode[store.Song](t, resp); got.Slug != created.Slug {
			t.Errorf("slug = %q, want %q", got.Slug, created.Slug)
		}
	})

	t.Run("an unknown address is 404, not 400", func(t *testing.T) {
		resp := h.do("GET", "/api/v1/songs/no-song-is-called-this", "", nil)
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", resp.StatusCode)
		}
	})

	// Every route naming a song must take both forms; no type enforces it, so
	// this subtest stands in for one.
	t.Run("a song moves in and out of a list at its slug", func(t *testing.T) {
		list := h.seedList(token, map[string]any{"name": "Ρεμπέτικα"})
		path := "/api/v1/lists/" + list.ID.String() + "/songs/" + created.Slug

		if resp := h.do("PUT", path, token, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("add status = %d, want 204", resp.StatusCode)
		}

		resp := h.do("GET", "/api/v1/songs/"+created.Slug+"/lists", token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("membership status = %d, want 200", resp.StatusCode)
		}
		membership := decode[struct {
			ListIDs []string `json:"list_ids"`
		}](t, resp)
		if len(membership.ListIDs) != 1 || membership.ListIDs[0] != list.ID.String() {
			t.Errorf("list_ids = %v, want just %s", membership.ListIDs, list.ID)
		}

		if resp := h.do("DELETE", path, token, nil); resp.StatusCode != http.StatusNoContent {
			t.Errorf("remove status = %d, want 204", resp.StatusCode)
		}
	})

	// Writes resolve the same way, and a retitle leaves the slug frozen.
	t.Run("a write reaches the song by its slug too", func(t *testing.T) {
		resp := h.do("PATCH", "/api/v1/songs/"+created.Slug, token, map[string]any{
			"title": "Θάλασσα Πλατειά",
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		patched := decode[store.Song](t, resp)
		if patched.ID != created.ID {
			t.Errorf("patched %s, want %s", patched.ID, created.ID)
		}
		if patched.Slug != created.Slug {
			t.Errorf("slug moved to %q on a retitle", patched.Slug)
		}
	})
}
