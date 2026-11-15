package api_test

import (
	"cmp"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

// publicListsPage reads one page of GET /public-lists as the given caller.
func (h *harness) publicListsPage(query, token string) httpx.ListResponse[store.PublicList] {
	h.t.Helper()

	resp := h.do("GET", "/api/v1/public-lists"+query, token, nil)
	if resp.StatusCode != http.StatusOK {
		h.t.Fatalf("public lists status = %d, want 200", resp.StatusCode)
	}
	return decode[httpx.ListResponse[store.PublicList]](h.t, resp)
}

func ids(lists []store.PublicList) []uuid.UUID {
	out := make([]uuid.UUID, len(lists))
	for i, l := range lists {
		out[i] = l.ID
	}
	return out
}

// The sitemap's walk. A private list must never be enumerable, for anyone:
// its owner's token changes nothing, since the walk is the same for every
// caller and a sitemap is built as a guest.
func TestPublicListsNeverEnumeratePrivateOnes(t *testing.T) {
	h := newHarness(t)
	ownerTok := h.tokenFor("owner@example.com", store.RoleUser)

	public := h.seedList(ownerTok, map[string]any{"name": "Shared", "is_public": true})
	private := h.seedList(ownerTok, map[string]any{"name": "Mine alone"})

	for _, caller := range []struct{ name, token string }{{"guest", ""}, {"owner", ownerTok}} {
		page := h.publicListsPage("", caller.token)

		if got := ids(page.Data); !slices.Equal(got, []uuid.UUID{public.ID}) {
			t.Errorf("%s: ids = %v, want only the public list %v", caller.name, got, public.ID)
		}
		if page.Meta.Total != 1 {
			t.Errorf("%s: total = %d, want 1 (the private list and the default list uncounted)", caller.name, page.Meta.Total)
		}
		if slices.Contains(ids(page.Data), private.ID) {
			t.Errorf("%s: the private list was enumerated", caller.name)
		}
	}

	// Unpublishing takes it out at once.
	path := "/api/v1/lists/" + public.ID.String()
	if resp := h.do("PATCH", path, ownerTok, map[string]any{"is_public": false}); resp.StatusCode != http.StatusOK {
		t.Fatalf("unpublish status = %d, want 200", resp.StatusCode)
	}
	if page := h.publicListsPage("", ""); page.Meta.Total != 0 || len(page.Data) != 0 {
		t.Errorf("after unpublishing: %+v, want empty", page)
	}
}

// Each entry is an address and a date: nothing whose list it is, what it is
// called, or what is in it.
func TestPublicListsCarryOnlyAnAddressAndADate(t *testing.T) {
	h := newHarness(t)
	ownerTok := h.tokenFor("owner@example.com", store.RoleUser)
	list := h.seedList(ownerTok, map[string]any{"name": "Shared", "is_public": true})

	resp := h.do("GET", "/api/v1/public-lists", "", nil)
	var raw struct {
		Data []map[string]json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(raw.Data) != 1 {
		t.Fatalf("data = %d entries, want 1", len(raw.Data))
	}
	keys := make([]string, 0, len(raw.Data[0]))
	for key := range raw.Data[0] {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	if got := strings.Join(keys, ","); got != "id,updated_at" {
		t.Errorf("fields = %s, want id,updated_at", got)
	}
	if got := strings.Trim(string(raw.Data[0]["id"]), `"`); got != list.ID.String() {
		t.Errorf("id = %s, want %s", got, list.ID)
	}
}

// Oldest first, id as tiebreak, so the walk's pages cannot shift under it; and
// a list created mid-walk appends after the last page rather than moving a row.
func TestPublicListsWalkInAStableOrder(t *testing.T) {
	h := newHarness(t)
	tokens := []string{
		h.tokenFor("one@example.com", store.RoleUser),
		h.tokenFor("two@example.com", store.RoleUser),
	}

	seeded := make([]store.List, 5)
	for i := range seeded {
		seeded[i] = h.seedList(tokens[i%2], map[string]any{
			"name":      "List " + string(rune('A'+i)),
			"is_public": true,
		})
	}
	slices.SortFunc(seeded, func(a, b store.List) int {
		return cmp.Or(a.CreatedAt.Compare(b.CreatedAt), strings.Compare(a.ID.String(), b.ID.String()))
	})
	want := make([]uuid.UUID, len(seeded), len(seeded)+1)
	for i, l := range seeded {
		want[i] = l.ID
	}

	first := h.publicListsPage("?limit=2", "")
	if first.Meta.Total != 5 || first.Meta.Limit != 2 || first.Meta.Offset != 0 {
		t.Errorf("first page meta = %+v, want total 5, limit 2, offset 0", first.Meta)
	}

	// Created between pages: it must land after everything already walked.
	late := h.seedList(tokens[0], map[string]any{"name": "Late", "is_public": true})

	walked := slices.Concat(
		ids(first.Data),
		ids(h.publicListsPage("?limit=2&offset=2", "").Data),
		ids(h.publicListsPage("?limit=2&offset=4", "").Data),
	)

	if !slices.Equal(walked, append(want, late.ID)) {
		t.Errorf("walk = %v, want %v then the late list %v", walked, want, late.ID)
	}

	// The API's usual clamp.
	if page := h.publicListsPage("?limit=1000", ""); page.Meta.Limit != httpx.MaxLimit {
		t.Errorf("limit = %d, want clamped to %d", page.Meta.Limit, httpx.MaxLimit)
	}
}
