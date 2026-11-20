package api_test

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/store"
)

func TestSongClicksAreCountedApartAndARepeatIsOneVisit(t *testing.T) {
	h := newHarness(t)
	user, token := h.userAndToken("listener@example.com", store.RoleUser)
	id := h.seedSong(user, "Opened")
	song := h.songByID(id)
	visitor := uuid.New()

	path := "/api/v1/songs/" + song.Slug + "/clicks"
	body := map[string]any{"visitor_id": visitor.String()}

	first := h.do("POST", path, "", body)
	if first.StatusCode != http.StatusOK {
		t.Fatalf("anonymous click = %d, want 200", first.StatusCode)
	}
	if got := decode[store.SongPopularity](t, first); got.AnonymousClicks != 1 || got.Score != 1 {
		t.Fatalf("click response = %+v, want the anonymous click counted", got)
	}
	// A repeat inside the window answers 200 as well, and does not move the tally.
	repeat := h.do("POST", path, "", body)
	if repeat.StatusCode != http.StatusOK {
		t.Fatalf("repeat click = %d, want 200", repeat.StatusCode)
	}
	if got := decode[store.SongPopularity](t, repeat); got.AnonymousClicks != 1 {
		t.Fatalf("repeat response = %+v, want the tally unchanged", got)
	}
	// A session counts as signed in even when the body also names a visitor.
	if resp := h.do("POST", path, token, body); resp.StatusCode != http.StatusOK {
		t.Fatalf("signed-in click = %d, want 200", resp.StatusCode)
	}
	// And a signed-in caller needs no visitor id.
	if resp := h.do("POST", "/api/v1/songs/"+id+"/clicks", token, map[string]any{}); resp.StatusCode != http.StatusOK {
		t.Fatalf("signed-in click without a visitor = %d, want 200", resp.StatusCode)
	}

	got := h.songByID(id).Popularity
	if got.AnonymousClicks != 1 || got.AuthenticatedClicks != 1 {
		t.Fatalf("clicks = %+v, want 1 anonymous and 1 signed in", got)
	}
	if got.Score != 2 {
		t.Fatalf("score = %d, want 2", got.Score)
	}
}

func TestSongClickRejectsAGuestWithoutAVisitor(t *testing.T) {
	h := newHarness(t)
	id := h.seedSong(nil, "Guestless")

	cases := []struct {
		name string
		body map[string]any
	}{
		{"omitted", map[string]any{}},
		{"blank", map[string]any{"visitor_id": "  "}},
		{"not a uuid", map[string]any{"visitor_id": "browser"}},
		{"nil uuid", map[string]any{"visitor_id": uuid.Nil.String()}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := h.do("POST", "/api/v1/songs/"+id+"/clicks", "", tc.body)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", resp.StatusCode)
			}
		})
	}
}

func TestSongClickOnAnUnknownSongIsNotFound(t *testing.T) {
	h := newHarness(t)
	body := map[string]any{"visitor_id": uuid.NewString()}

	for _, path := range []string{
		"/api/v1/songs/" + uuid.NewString() + "/clicks",
		"/api/v1/songs/no-such-song/clicks",
	} {
		resp := h.do("POST", path, "", body)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s = %d, want 404", path, resp.StatusCode)
		}
	}
}

func TestPopularitySortOrdersTheCatalog(t *testing.T) {
	h := newHarness(t)
	quiet := h.seedSong(nil, "Quiet Song")
	loved := h.seedSong(nil, "Loved Song")

	for range 3 {
		resp := h.do("POST", "/api/v1/songs/"+loved+"/clicks", "", map[string]any{
			"visitor_id": uuid.NewString(),
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("click = %d, want 200", resp.StatusCode)
		}
	}

	resp := h.do("GET", "/api/v1/songs?sort=popularity", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	page := decode[struct {
		Data []store.Song `json:"data"`
	}](t, resp)
	if len(page.Data) != 2 || page.Data[0].ID.String() != loved {
		t.Fatalf("order = %v, want the clicked song first", titlesOf(page.Data))
	}
	if page.Data[1].ID.String() != quiet {
		t.Fatalf("second = %s, want the unclicked song", page.Data[1].ID)
	}

	rejected := h.do("GET", "/api/v1/songs?sort=nope", "", nil)
	if rejected.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown sort = %d, want 400", rejected.StatusCode)
	}
}

func TestSongClicksAreRateLimited(t *testing.T) {
	h := newHarness(t)
	id := h.seedSong(nil, "Flooded")

	var limited bool
	for range clickAttemptsBeyondTheLimit() {
		resp := h.do("POST", "/api/v1/songs/"+id+"/clicks", "", map[string]any{
			"visitor_id": uuid.NewString(),
		})
		if resp.StatusCode == http.StatusTooManyRequests {
			limited = true
			break
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("click = %d, want 200 or 429", resp.StatusCode)
		}
	}
	if !limited {
		t.Fatal("recording clicks in a loop must start being refused")
	}
}

// clickAttemptsBeyondTheLimit is one more POST than the handler allows. The
// limit itself is unexported; 61 is clickRateLimit + 1, and a change that
// raises the limit without moving this fails the test closed (it errors)
// rather than passing a limiter that no longer bounds anything.
func clickAttemptsBeyondTheLimit() int { return 61 }

func (h *harness) songByID(id string) store.Song {
	h.t.Helper()
	resp := h.do("GET", "/api/v1/songs/"+id, "", nil)
	if resp.StatusCode != http.StatusOK {
		h.t.Fatalf("get song = %d, want 200", resp.StatusCode)
	}
	return decode[store.Song](h.t, resp)
}

func titlesOf(songs []store.Song) []string {
	out := make([]string, len(songs))
	for i, song := range songs {
		out[i] = song.Title
	}
	return out
}
