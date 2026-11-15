package api_test

import (
	"cmp"
	"maps"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

// creditedPeoplePage reads one page of GET /credited-people as a guest.
func (h *harness) creditedPeoplePage(query string) httpx.ListResponse[store.CreditedPerson] {
	h.t.Helper()

	resp := h.do("GET", "/api/v1/credited-people"+query, "", nil)
	if resp.StatusCode != http.StatusOK {
		h.t.Fatalf("credited people status = %d, want 200", resp.StatusCode)
	}
	return decode[httpx.ListResponse[store.CreditedPerson]](h.t, resp)
}

// seedPerson stores a person, credited on nothing.
func (h *harness) seedPerson(name string) *store.Person {
	h.t.Helper()

	p, err := h.store.UpsertPerson(h.t.Context(), name)
	if err != nil {
		h.t.Fatalf("seed person: %v", err)
	}
	return p
}

func personIDs(people []store.CreditedPerson) []uuid.UUID {
	out := make([]uuid.UUID, len(people))
	for i, p := range people {
		out[i] = p.ID
	}
	return out
}

// creditSong stores a song crediting `writer` as its composer and `singer` as
// the performer of its one recording; either may be nil.
func (h *harness) creditSong(title string, writer, singer *store.Person) uuid.UUID {
	h.t.Helper()

	in := store.SongInput{Title: title, Lyrics: "words", Language: "el"}
	if writer != nil {
		in.Credits = []store.Credit{{PersonID: writer.ID, Role: store.CreditComposer}}
	}
	if singer != nil {
		in.Recordings = []store.RecordingInput{{Performers: []store.RecordingPerformer{{PersonID: singer.ID}}}}
	}
	song, err := h.store.CreateSong(h.t.Context(), in, uuid.Nil)
	if err != nil {
		h.t.Fatalf("CreateSong: %v", err)
	}
	return song.ID
}

// The sitemap's people: a writer and a performer both count, since a person's
// catalog page lists both; someone on no song does not, their page being an
// empty catalog; and someone who wrote and performed one song is one entry.
func TestCreditedPeopleAreThoseOnASong(t *testing.T) {
	h := newHarness(t)
	adminTok := h.tokenFor("admin@example.com", store.RoleAdmin)

	writer := h.seedPerson("Writes Songs")
	singer := h.seedPerson("Sings Songs")
	both := h.seedPerson("Does Both")
	h.seedPerson("On Nothing")

	h.creditSong("Written", writer, nil)
	sung := h.creditSong("Sung", nil, singer)
	h.creditSong("Both", both, both)

	page := h.creditedPeoplePage("")
	got := slices.SortedFunc(slices.Values(personIDs(page.Data)), compareUUID)
	want := slices.SortedFunc(slices.Values([]uuid.UUID{writer.ID, singer.ID, both.ID}), compareUUID)
	if !slices.Equal(got, want) {
		t.Errorf("ids = %v, want the writer, the singer and the one who does both, once each: %v", got, want)
	}
	if page.Meta.Total != 3 {
		t.Errorf("total = %d, want 3", page.Meta.Total)
	}

	// Losing their last song takes them out.
	if resp := h.do("DELETE", "/api/v1/songs/"+sung.String(), adminTok, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete song status = %d, want 204", resp.StatusCode)
	}
	if got := personIDs(h.creditedPeoplePage("").Data); slices.Contains(got, singer.ID) {
		t.Errorf("after their only song was deleted, ids = %v still include the singer", got)
	}
}

// Each entry is the id a person's page is addressed by, and nothing else.
func TestCreditedPeopleCarryOnlyAnID(t *testing.T) {
	h := newHarness(t)
	h.creditSong("Written", h.seedPerson("Writes Songs"), nil)

	raw := decode[struct {
		Data []map[string]any `json:"data"`
	}](t, h.do("GET", "/api/v1/credited-people", "", nil))
	if len(raw.Data) != 1 {
		t.Fatalf("data = %d entries, want 1", len(raw.Data))
	}
	if got := slices.Sorted(maps.Keys(raw.Data[0])); !slices.Equal(got, []string{"id"}) {
		t.Errorf("fields = %v, want [id]", got)
	}
}

// Oldest first, id as tiebreak, so the walk's pages cannot shift under it,
// not even for a rename (which would move a row in /people's order); and a
// person created mid-walk appends after the last page.
func TestCreditedPeopleWalkInAStableOrder(t *testing.T) {
	h := newHarness(t)
	adminTok := h.tokenFor("admin@example.com", store.RoleAdmin)

	seeded := make([]*store.Person, 5)
	for i := range seeded {
		seeded[i] = h.seedPerson("Person " + string(rune('A'+i)))
		h.creditSong("Song "+string(rune('A'+i)), seeded[i], nil)
	}
	slices.SortFunc(seeded, func(a, b *store.Person) int {
		return cmp.Or(a.CreatedAt.Compare(b.CreatedAt), compareUUID(a.ID, b.ID))
	})
	want := make([]uuid.UUID, len(seeded), len(seeded)+1)
	for i, p := range seeded {
		want[i] = p.ID
	}

	first := h.creditedPeoplePage("?limit=2")
	if first.Meta.Total != 5 || first.Meta.Limit != 2 || first.Meta.Offset != 0 {
		t.Errorf("first page meta = %+v, want total 5, limit 2, offset 0", first.Meta)
	}

	// Between pages: a rename that would reorder a name sort, and a newcomer.
	rename := "/api/v1/people/" + want[len(want)-1].String()
	if resp := h.do("PATCH", rename, adminTok, map[string]any{"name": "Aaa First By Name"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("rename status = %d, want 200", resp.StatusCode)
	}
	late := h.seedPerson("Late")
	h.creditSong("Late Song", late, nil)

	walked := slices.Concat(
		personIDs(first.Data),
		personIDs(h.creditedPeoplePage("?limit=2&offset=2").Data),
		personIDs(h.creditedPeoplePage("?limit=2&offset=4").Data),
	)
	if !slices.Equal(walked, append(want, late.ID)) {
		t.Errorf("walk = %v, want %v then the late person %v", walked, want, late.ID)
	}

	// The API's usual clamp.
	if page := h.creditedPeoplePage("?limit=1000"); page.Meta.Limit != httpx.MaxLimit {
		t.Errorf("limit = %d, want clamped to %d", page.Meta.Limit, httpx.MaxLimit)
	}
}

func compareUUID(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) }
