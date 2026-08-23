package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/api"
	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/config"
	"github.com/christos/lyrics/backend/internal/prelude"
	"github.com/christos/lyrics/backend/internal/store"
	"github.com/christos/lyrics/backend/internal/testutil"
)

// harness is a full API server wired to a real database, a locally served key
// set, and a fake Prelude.
type harness struct {
	t       *testing.T
	server  *httptest.Server
	store   *store.Store
	prelude *prelude.Fake
	issuer  *testutil.TokenIssuer
}

func newHarness(t *testing.T, adminEmails ...string) *harness {
	t.Helper()

	st := testutil.NewStore(t)
	issuer := testutil.NewTokenIssuer(t)
	fake := prelude.NewFake()

	cfg := config.Config{
		PreludeAppID:   "test-app",
		PreludeAPIKey:  "test-key",
		PreludeAPIBase: "http://prelude.invalid",
		PreludeJWKSURL: issuer.JWKSURL,
		PreludeIssuer:  issuer.Issuer,
		AdminEmails:    adminEmails,
		CORSOrigins:    []string{"http://localhost:5173"},
	}

	verifier, err := auth.NewVerifier(context.Background(), cfg.JWKSURL(), cfg.Issuer())
	if err != nil {
		t.Fatalf("NewVerifier: %v", err)
	}

	srv := api.NewServer(cfg, st, fake, auth.NewAuthenticator(verifier, st, cfg.IsBootstrapAdmin))
	httpServer := httptest.NewServer(srv.Routes())
	t.Cleanup(httpServer.Close)

	return &harness{t: t, server: httpServer, store: st, prelude: fake, issuer: issuer}
}

// sign mints a bearer token for a stored user. Every test principal is signed
// here, so the claims a token carries cannot drift between the tests that
// provision their user, the ones that register it over the API, and the ones
// that only need a token.
func (h *harness) sign(u *store.User) string {
	h.t.Helper()

	return h.issuer.Sign(h.t, testutil.TokenOptions{UserID: u.PreludeUserID, Email: u.Email})
}

// userAndToken provisions a verified user at the given role and returns both
// the stored record and a bearer token for it.
func (h *harness) userAndToken(email string, role store.Role) (*store.User, string) {
	h.t.Helper()

	u := h.user(email, role)
	return u, h.sign(u)
}

// tokenFor provisions a user at the given role and returns a bearer token.
func (h *harness) tokenFor(email string, role store.Role) string {
	h.t.Helper()

	_, token := h.userAndToken(email, role)
	return token
}

func (h *harness) do(method, path, token string, body any) *http.Response {
	h.t.Helper()

	if body == nil {
		return h.doRaw(method, path, token, "", nil)
	}
	payload, err := json.Marshal(body)
	if err != nil {
		h.t.Fatalf("marshal body: %v", err)
	}
	return h.doRaw(method, path, token, "application/json", payload)
}

// doRaw sends a body the JSON decoder never sees, which is what an avatar
// upload is. `do` marshals through it, so the two cannot drift apart in how a
// request is built.
func (h *harness) doRaw(method, path, token, contentType string, body []byte) *http.Response {
	h.t.Helper()

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}

	req, err := http.NewRequest(method, h.server.URL+path, reader)
	if err != nil {
		h.t.Fatalf("build request: %v", err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return h.send(req)
}

// doConditional repeats a GET with an If-None-Match, which is the one header no
// other test needs and so is not worth threading through `do`.
func (h *harness) doConditional(path, etag string) *http.Response {
	h.t.Helper()

	req, err := http.NewRequest("GET", h.server.URL+path, nil)
	if err != nil {
		h.t.Fatalf("build request: %v", err)
	}
	req.Header.Set("If-None-Match", etag)
	return h.send(req)
}

func (h *harness) send(req *http.Request) *http.Response {
	h.t.Helper()

	resp, err := h.server.Client().Do(req)
	if err != nil {
		h.t.Fatalf("%s %s: %v", req.Method, req.URL.Path, err)
	}
	h.t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func decode[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	var out T
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

// seedSong inserts a song owned by the given user and returns its ID.
func (h *harness) seedSong(owner *store.User, title string) string {
	h.t.Helper()

	ownerID := store.User{}.ID
	if owner != nil {
		ownerID = owner.ID
	}
	song, err := h.store.CreateSong(context.Background(), store.SongInput{
		Title: title, Lyrics: "some lyrics", Language: "el",
	}, ownerID)
	if err != nil {
		h.t.Fatalf("seed song: %v", err)
	}
	return song.ID.String()
}

// seedList creates a list over the API and returns it, so the create-assert-
// decode preamble lives here rather than at the head of every list test.
func (h *harness) seedList(token string, body map[string]any) store.List {
	h.t.Helper()

	resp := h.do("POST", "/api/v1/lists", token, body)
	if resp.StatusCode != http.StatusCreated {
		h.t.Fatalf("seed list status = %d, want 201", resp.StatusCode)
	}
	return decode[store.List](h.t, resp)
}

// user provisions a verified account, which is the state every test that is not
// about verification wants: an unverified principal is refused by everything
// except reading its own profile.
func (h *harness) user(email string, role store.Role) *store.User {
	h.t.Helper()

	u := h.unverifiedUser(email, role)
	verified, err := h.store.MarkEmailVerified(context.Background(), u.ID)
	if err != nil {
		h.t.Fatalf("mark email verified: %v", err)
	}
	return verified
}

// unverifiedUser provisions an account that has not confirmed its address.
func (h *harness) unverifiedUser(email string, role store.Role) *store.User {
	h.t.Helper()

	u, err := h.store.ProvisionUser(context.Background(), "usr_"+email, email, role)
	if err != nil {
		h.t.Fatalf("provision user: %v", err)
	}
	return u
}

// TestRBACMatrix walks every protected route at every role, which is the only
// way to be sure a route was not accidentally mounted in the wrong group.
func TestRBACMatrix(t *testing.T) {
	h := newHarness(t)

	guest := ""
	userTok := h.tokenFor("user@example.com", store.RoleUser)
	contribTok := h.tokenFor("contrib@example.com", store.RoleContributor)
	adminTok := h.tokenFor("admin@example.com", store.RoleAdmin)

	songID := h.seedSong(nil, "Existing Song")

	// Owned by a fifth user so the copy row below exercises the stranger case
	// for every role in the matrix.
	sharerTok := h.tokenFor("sharer@example.com", store.RoleUser)
	sharedListID := h.seedList(sharerTok,
		map[string]any{"name": "Shared Picks", "is_public": true}).ID.String()

	newSong := map[string]any{"title": "New Song", "lyrics": "la la", "language": "el"}

	tests := []struct {
		name   string
		method string
		path   string
		body   any
		// expected status per role: guest, user, contributor, admin
		guest, user, contributor, admin int
	}{
		{
			name: "browse songs", method: "GET", path: "/api/v1/songs",
			guest: 200, user: 200, contributor: 200, admin: 200,
		},
		{
			name: "read a song", method: "GET", path: "/api/v1/songs/" + songID,
			guest: 200, user: 200, contributor: 200, admin: 200,
		},
		{
			name: "list genres", method: "GET", path: "/api/v1/genres",
			guest: 200, user: 200, contributor: 200, admin: 200,
		},
		{
			name: "list people", method: "GET", path: "/api/v1/people",
			guest: 200, user: 200, contributor: 200, admin: 200,
		},
		{
			name: "read own profile", method: "GET", path: "/api/v1/me",
			guest: 401, user: 200, contributor: 200, admin: 200,
		},
		{
			name: "list own lists", method: "GET", path: "/api/v1/lists",
			guest: 401, user: 200, contributor: 200, admin: 200,
		},
		{
			name: "create a song", method: "POST", path: "/api/v1/songs", body: newSong,
			guest: 401, user: 403, contributor: 201, admin: 201,
		},
		{
			name: "create a person", method: "POST", path: "/api/v1/people",
			body:  map[string]any{"name": "Someone"},
			guest: 401, user: 403, contributor: 201, admin: 201,
		},
		{
			name: "delete a song", method: "DELETE", path: "/api/v1/songs/" + songID,
			// Only the admin case actually deletes; it runs last.
			guest: 401, user: 403, contributor: 403, admin: 204,
		},
		{
			name: "copy a public list", method: "POST", path: "/api/v1/lists/" + sharedListID + "/copy",
			body: map[string]any{},
			// The list belongs to none of these roles, so each copies it as a
			// stranger and the three copies land under different owners.
			guest: 401, user: 201, contributor: 201, admin: 201,
		},
		{
			name: "list all users", method: "GET", path: "/api/v1/admin/users",
			guest: 401, user: 403, contributor: 403, admin: 200,
		},
		{
			name: "read a profile picture", method: "GET",
			path: "/api/v1/users/" + uuid.NewString() + "/avatar",
			// Public, because an <img> carries no Authorization header. Nobody
			// here has a picture, so every role sees the same 404 — a 401 for
			// the guest would mean the route had been mounted behind
			// authentication, where its own owner could not load it either.
			guest: 404, user: 404, contributor: 404, admin: 404,
		},
	}

	for _, tt := range tests {
		for _, role := range []struct {
			label string
			token string
			want  int
		}{
			{"guest", guest, tt.guest},
			{"user", userTok, tt.user},
			{"contributor", contribTok, tt.contributor},
			{"admin", adminTok, tt.admin},
		} {
			t.Run(tt.name+"/"+role.label, func(t *testing.T) {
				resp := h.do(tt.method, tt.path, role.token, tt.body)
				if resp.StatusCode != role.want {
					body, _ := io.ReadAll(resp.Body)
					t.Errorf("%s %s as %s = %d, want %d\nbody: %s",
						tt.method, tt.path, role.label, resp.StatusCode, role.want, body)
				}
			})
		}
	}
}

// The contributor role exists to let trusted users grow the catalog, not to let
// any one of them rewrite another's work.
func TestContributorCanEditOnlyOwnSongs(t *testing.T) {
	h := newHarness(t)

	author, authorTok := h.userAndToken("author@example.com", store.RoleContributor)

	otherTok := h.tokenFor("other@example.com", store.RoleContributor)
	adminTok := h.tokenFor("admin@example.com", store.RoleAdmin)

	songID := h.seedSong(author, "Owned Song")
	edit := map[string]any{"title": "Edited", "lyrics": "new lyrics", "language": "el"}

	t.Run("author may edit", func(t *testing.T) {
		if resp := h.do("PATCH", "/api/v1/songs/"+songID, authorTok, edit); resp.StatusCode != 200 {
			t.Errorf("status = %d, want 200", resp.StatusCode)
		}
	})

	t.Run("another contributor may not", func(t *testing.T) {
		if resp := h.do("PATCH", "/api/v1/songs/"+songID, otherTok, edit); resp.StatusCode != 403 {
			t.Errorf("status = %d, want 403", resp.StatusCode)
		}
	})

	t.Run("admin may edit anything", func(t *testing.T) {
		if resp := h.do("PATCH", "/api/v1/songs/"+songID, adminTok, edit); resp.StatusCode != 200 {
			t.Errorf("status = %d, want 200", resp.StatusCode)
		}
	})
}

// A present-but-invalid token must be rejected rather than silently downgraded
// to guest, so the client knows to refresh instead of rendering signed-out
// content to someone who is signed in.
func TestInvalidTokenRejectedOnPublicRoute(t *testing.T) {
	h := newHarness(t)

	resp := h.do("GET", "/api/v1/songs", "not-a-real-token", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}

	// The same route with no header at all must succeed as a guest.
	if resp := h.do("GET", "/api/v1/songs", "", nil); resp.StatusCode != http.StatusOK {
		t.Errorf("guest status = %d, want 200", resp.StatusCode)
	}
}

// Roles live in this database, not in the token, so a promotion must take
// effect on the very next request with the same unchanged token.
func TestRoleChangeTakesEffectWithoutNewToken(t *testing.T) {
	h := newHarness(t)

	subject, token := h.userAndToken("promote@example.com", store.RoleUser)

	newSong := map[string]any{"title": "Before", "lyrics": "x", "language": "el"}
	if resp := h.do("POST", "/api/v1/songs", token, newSong); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status before promotion = %d, want 403", resp.StatusCode)
	}

	if _, err := h.store.SetRole(context.Background(), subject.ID, store.RoleContributor); err != nil {
		t.Fatalf("SetRole: %v", err)
	}

	// Same token, no re-login.
	if resp := h.do("POST", "/api/v1/songs", token, newSong); resp.StatusCode != http.StatusCreated {
		t.Fatalf("status after promotion = %d, want 201", resp.StatusCode)
	}
}

// A valid token for an account this database has never seen must provision it
// rather than fail, which is what keeps the two systems from drifting apart.
func TestJustInTimeProvisioning(t *testing.T) {
	h := newHarness(t, "boss@example.com")

	t.Run("unknown user becomes a plain user", func(t *testing.T) {
		token := h.issuer.Sign(t, testutil.TokenOptions{
			UserID: "usr_never_seen", Email: "stranger@example.com"})

		resp := h.do("GET", "/api/v1/me", token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		user := decode[store.User](t, resp)
		if user.Role != store.RoleUser {
			t.Errorf("role = %q, want %q", user.Role, store.RoleUser)
		}
	})

	// Without this, a fresh deployment would have no admin and no way to
	// appoint one.
	t.Run("bootstrap email becomes admin", func(t *testing.T) {
		token := h.issuer.Sign(t, testutil.TokenOptions{
			UserID: "usr_boss", Email: "boss@example.com"})

		resp := h.do("GET", "/api/v1/me", token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		user := decode[store.User](t, resp)
		if user.Role != store.RoleAdmin {
			t.Errorf("role = %q, want %q", user.Role, store.RoleAdmin)
		}
	})

	// A token with no email cannot provision an account, and must say so
	// rather than create a broken record.
	t.Run("missing email claim is refused", func(t *testing.T) {
		token := h.issuer.Sign(t, testutil.TokenOptions{
			UserID: "usr_no_email", OmitEmail: true})

		resp := h.do("GET", "/api/v1/me", token, nil)
		if resp.StatusCode != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500", resp.StatusCode)
		}
	})
}

// Lists are private by default; a private list must be indistinguishable from a
// nonexistent one so identifiers cannot be probed.
func TestListVisibility(t *testing.T) {
	h := newHarness(t)

	ownerTok := h.tokenFor("owner@example.com", store.RoleUser)
	strangerTok := h.tokenFor("stranger@example.com", store.RoleUser)

	list := h.seedList(ownerTok, map[string]any{"name": "Private Picks"})
	path := "/api/v1/lists/" + list.ID.String()

	if resp := h.do("GET", path, ownerTok, nil); resp.StatusCode != 200 {
		t.Errorf("owner read = %d, want 200", resp.StatusCode)
	}
	if resp := h.do("GET", path, strangerTok, nil); resp.StatusCode != 404 {
		t.Errorf("stranger read of private list = %d, want 404", resp.StatusCode)
	}
	if resp := h.do("GET", path, "", nil); resp.StatusCode != 404 {
		t.Errorf("guest read of private list = %d, want 404", resp.StatusCode)
	}

	if resp := h.do("PATCH", path, ownerTok, map[string]any{"is_public": true}); resp.StatusCode != 200 {
		t.Fatalf("publish status = %d, want 200", resp.StatusCode)
	}

	if resp := h.do("GET", path, "", nil); resp.StatusCode != 200 {
		t.Errorf("guest read of public list = %d, want 200", resp.StatusCode)
	}

	// Another user still may not modify it.
	if resp := h.do("PATCH", path, strangerTok, map[string]any{"name": "Hijacked"}); resp.StatusCode != 404 {
		t.Errorf("stranger write = %d, want 404", resp.StatusCode)
	}
}

// Order is the point of a list, and the drag-and-drop UI calls this endpoint on
// every drop — so what it does with a partial, unknown or repeated id is worth
// pinning rather than inferring from the songs that happen to come back.
func TestReorderList(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("curator@example.com", store.RoleUser)

	path := "/api/v1/lists/" + h.seedList(token, map[string]any{"name": "In Order"}).ID.String()

	// Added first to last, so every assertion below is about position rather
	// than about insertion order.
	songs := make([]string, 4)
	for i := range songs {
		songs[i] = h.seedSong(nil, fmt.Sprintf("Song %d", i))
		if resp := h.do("PUT", path+"/songs/"+songs[i], token, nil); resp.StatusCode != 204 {
			t.Fatalf("add song %d status = %d, want 204", i, resp.StatusCode)
		}
	}

	// order reads back the list's current sequence as indices into `songs`.
	order := func() []int {
		t.Helper()
		resp := h.do("GET", path, token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("read list status = %d, want 200", resp.StatusCode)
		}
		var got []int
		for _, song := range decode[store.List](t, resp).Songs {
			got = append(got, slices.Index(songs, song.ID.String()))
		}
		return got
	}

	reorder := func(ids ...string) *http.Response {
		t.Helper()
		return h.do("POST", path+"/reorder", token, map[string]any{"song_ids": ids})
	}

	t.Run("a full payload is applied verbatim", func(t *testing.T) {
		if resp := reorder(songs[3], songs[1], songs[0], songs[2]); resp.StatusCode != 200 {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if got := order(); !slices.Equal(got, []int{3, 1, 0, 2}) {
			t.Errorf("order = %v, want [3 1 0 2]", got)
		}
	})

	// A client working from a stale page must not be able to drop the songs it
	// never knew about — they go after the ordered ones, keeping their sequence.
	t.Run("songs left out keep their relative order at the end", func(t *testing.T) {
		if resp := reorder(songs[2], songs[0]); resp.StatusCode != 200 {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if got := order(); !slices.Equal(got, []int{2, 0, 3, 1}) {
			t.Errorf("order = %v, want [2 0 3 1] (3 before 1, as they already were)", got)
		}
	})

	t.Run("a song outside the list is rejected and changes nothing", func(t *testing.T) {
		before := order()
		stranger := h.seedSong(nil, "Not In This List")

		if resp := reorder(songs[0], stranger, songs[1]); resp.StatusCode != 404 {
			t.Errorf("status = %d, want 404", resp.StatusCode)
		}
		// The whole reorder runs in one transaction, so the ids that *were* in
		// the list must not have been written either.
		if got := order(); !slices.Equal(got, before) {
			t.Errorf("order = %v, want %v unchanged", got, before)
		}
	})

	t.Run("a repeated song is a validation error, not a missing one", func(t *testing.T) {
		resp := reorder(songs[0], songs[1], songs[0])
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("status = %d, want 422", resp.StatusCode)
		}
	})

	t.Run("an empty payload is refused", func(t *testing.T) {
		if resp := reorder(); resp.StatusCode != http.StatusUnprocessableEntity {
			t.Errorf("status = %d, want 422", resp.StatusCode)
		}
	})

	t.Run("only the owner may reorder", func(t *testing.T) {
		strangerTok := h.tokenFor("meddler@example.com", store.RoleUser)
		resp := h.do("POST", path+"/reorder", strangerTok,
			map[string]any{"song_ids": []string{songs[0]}})
		if resp.StatusCode != 404 {
			t.Errorf("status = %d, want 404", resp.StatusCode)
		}
	})
}

// Copying is how a shared list becomes something its reader can change: the
// copy belongs to whoever took it, keeps the curated order, and starts private.
func TestCopyPublicList(t *testing.T) {
	h := newHarness(t)

	ownerTok := h.tokenFor("sharer@example.com", store.RoleUser)
	stranger, strangerTok := h.userAndToken("taker@example.com", store.RoleUser)

	source := h.seedList(ownerTok, map[string]any{
		"name": "Rebetika Nights", "description": "For the long evenings.", "is_public": true,
	})
	path := "/api/v1/lists/" + source.ID.String()

	first := h.seedSong(nil, "Πρώτο Τραγούδι")
	second := h.seedSong(nil, "Δεύτερο Τραγούδι")
	for _, songID := range []string{first, second} {
		if resp := h.do("PUT", path+"/songs/"+songID, ownerTok, nil); resp.StatusCode != 204 {
			t.Fatalf("add song status = %d, want 204", resp.StatusCode)
		}
	}
	// Reordered before copying, so the assertion below tests that positions are
	// carried over rather than that the entries happen to be inserted in order.
	if resp := h.do("POST", path+"/reorder", ownerTok, map[string]any{
		"song_ids": []string{second, first},
	}); resp.StatusCode != 200 {
		t.Fatalf("reorder status = %d, want 200", resp.StatusCode)
	}

	resp := h.do("POST", path+"/copy", strangerTok, map[string]any{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("copy status = %d, want 201", resp.StatusCode)
	}
	copied := decode[store.List](t, resp)

	// Seven independent properties, each checked on its own: a switch would
	// report the first and hide the rest, which is the opposite of what a
	// property list is for.
	if copied.ID == source.ID {
		t.Error("copy reused the source's identifier")
	}
	if copied.OwnerID != stranger.ID {
		t.Errorf("copy owner = %s, want %s", copied.OwnerID, stranger.ID)
	}
	if copied.Name != source.Name {
		t.Errorf("copy name = %q, want %q", copied.Name, source.Name)
	}
	if copied.Description == nil || *copied.Description != "For the long evenings." {
		t.Errorf("copy description = %v, want the source's", copied.Description)
	}
	if copied.IsPublic {
		t.Error("copy is public; a copy must start private")
	}
	if copied.IsDefault {
		t.Error("copy is marked default")
	}
	if copied.ItemCount != 2 {
		t.Errorf("copy item_count = %d, want 2", copied.ItemCount)
	}

	resp = h.do("GET", "/api/v1/lists/"+copied.ID.String(), strangerTok, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("read copy status = %d, want 200", resp.StatusCode)
	}
	full := decode[store.List](t, resp)
	if len(full.Songs) != 2 {
		t.Fatalf("copy holds %d songs, want 2", len(full.Songs))
	}
	if full.Songs[0].ID.String() != second || full.Songs[1].ID.String() != first {
		t.Errorf("copy order = %v, want the source's curated order", []uuid.UUID{full.Songs[0].ID, full.Songs[1].ID})
	}

	// A second copy would collide with the first on the per-owner name index.
	resp = h.do("POST", path+"/copy", strangerTok, map[string]any{})
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("second copy status = %d, want 409", resp.StatusCode)
	}
	resp = h.do("POST", path+"/copy", strangerTok, map[string]any{"name": "Rebetika Nights (again)"})
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("renamed copy status = %d, want 201", resp.StatusCode)
	}

	// Editing the copy leaves the original alone — the two share no rows.
	if resp := h.do("DELETE", "/api/v1/lists/"+copied.ID.String()+"/songs/"+first, strangerTok, nil); resp.StatusCode != 204 {
		t.Fatalf("remove from copy status = %d, want 204", resp.StatusCode)
	}
	if resp := h.do("GET", path, ownerTok, nil); decode[store.List](t, resp).ItemCount != 2 {
		t.Error("editing the copy changed the source list")
	}
}

// A private list must be no more copyable than it is readable, and must answer
// the same way — 404 — so copying cannot be used to probe for identifiers.
func TestCopyPrivateListIsNotFound(t *testing.T) {
	h := newHarness(t)

	ownerTok := h.tokenFor("private-owner@example.com", store.RoleUser)
	strangerTok := h.tokenFor("prober@example.com", store.RoleUser)

	path := "/api/v1/lists/" + h.seedList(ownerTok, map[string]any{"name": "Private Picks"}).ID.String() + "/copy"

	if resp := h.do("POST", path, strangerTok, map[string]any{}); resp.StatusCode != 404 {
		t.Errorf("stranger copy of private list = %d, want 404", resp.StatusCode)
	}
	if resp := h.do("POST", path, "", map[string]any{}); resp.StatusCode != 401 {
		t.Errorf("guest copy = %d, want 401", resp.StatusCode)
	}
	// The owner duplicating their own list needs a free name, but is allowed.
	if resp := h.do("POST", path, ownerTok, map[string]any{"name": "Private Picks Copy"}); resp.StatusCode != 201 {
		t.Errorf("owner copy of own list = %d, want 201", resp.StatusCode)
	}
}

func TestDefaultListCannotBeDeleted(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("user@example.com", store.RoleUser)

	resp := h.do("GET", "/api/v1/lists", token, nil)
	lists := decode[struct {
		Data []store.List `json:"data"`
	}](t, resp)

	if len(lists.Data) != 1 || !lists.Data[0].IsDefault {
		t.Fatalf("expected exactly one default list, got %+v", lists.Data)
	}

	resp = h.do("DELETE", "/api/v1/lists/"+lists.Data[0].ID.String(), token, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
}

// Demoting or deleting the last admin would leave nobody able to administer the
// platform, with no way to recover through the API.
func TestLastAdminIsProtected(t *testing.T) {
	h := newHarness(t)

	admin, token := h.userAndToken("solo-admin@example.com", store.RoleAdmin)

	path := "/api/v1/admin/users/" + admin.ID.String() + "/role"
	resp := h.do("PATCH", path, token, map[string]any{"role": "user"})
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("self-demotion status = %d, want 409", resp.StatusCode)
	}

	// With a second admin present the demotion is allowed.
	h.user("second-admin@example.com", store.RoleAdmin)
	resp = h.do("PATCH", path, token, map[string]any{"role": "user"})
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Errorf("status = %d, want 200 once another admin exists\nbody: %s", resp.StatusCode, body)
	}
}

// manyRecordings and manyPerformers build a payload one over a cap, so the
// numbers in the cases below are read from the constants rather than restated.
func manyRecordings(n int) []map[string]any {
	out := make([]map[string]any, n)
	for i := range out {
		out[i] = map[string]any{"release_year": 1900 + i}
	}
	return out
}

func manyPerformers(n int) []map[string]any {
	out := make([]map[string]any, n)
	for i := range out {
		out[i] = map[string]any{"name": fmt.Sprintf("Performer %d", i), "position": i}
	}
	return out
}

func TestSongValidation(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("contrib@example.com", store.RoleContributor)

	tests := []struct {
		name string
		body map[string]any
		want int
	}{
		{"missing title", map[string]any{"lyrics": "x"}, 422},
		{"blank title", map[string]any{"title": "   ", "lyrics": "x"}, 422},
		{"bad language", map[string]any{"title": "T", "language": "greek"}, 422},
		{"bad youtube url", map[string]any{
			"title":      "T",
			"recordings": []map[string]any{{"youtube_url": "https://vimeo.com/123"}},
		}, 422},
		{"bad release year", map[string]any{
			"title":      "T",
			"recordings": []map[string]any{{"release_year": 42}},
		}, 422},
		{"bad credit role", map[string]any{
			"title":   "T",
			"credits": []map[string]any{{"name": "X", "role": "producer"}},
		}, 422},
		// Performing is not a credit role since 000009, so the spelling that
		// used to be the most common one is now refused rather than stored
		// somewhere nothing reads.
		{"a performing role on a credit", map[string]any{
			"title":   "T",
			"credits": []map[string]any{{"name": "X", "role": "artist"}},
		}, 422},
		{"two first recordings", map[string]any{
			"title": "T",
			"recordings": []map[string]any{
				{"label": "one", "is_first": true},
				{"label": "two", "is_first": true},
			},
		}, 422},
		{"a performer with neither id nor name", map[string]any{
			"title":      "T",
			"recordings": []map[string]any{{"performers": []map[string]any{{"position": 0}}}},
		}, 422},
		// The caps bound the work rather than the wire: every performer named
		// inline is one sequential person upsert holding a pooled connection.
		// The numbers are one over maxRecordings and maxPerformers, spelled out
		// because this is an external test package and cannot read them — they
		// are part of the observable contract either way, so a change to either
		// constant should be a change here.
		{"too many recordings", map[string]any{
			"title":      "T",
			"recordings": manyRecordings(17),
		}, 422},
		{"too many performers across the recordings", map[string]any{
			"title":      "T",
			"recordings": []map[string]any{{"performers": manyPerformers(65)}},
		}, 422},
		// The link and the year moved onto recordings, and a payload still
		// naming them at the top level is refused rather than quietly ignored.
		{"a song-level youtube url", map[string]any{
			"title":       "T",
			"youtube_url": "https://youtu.be/dQw4w9WgXcQ",
		}, 400},
		{"a song-level release year", map[string]any{"title": "T", "release_year": 1964}, 400},
		{"unknown field", map[string]any{"title": "T", "colour": "blue"}, 400},
		{"valid", map[string]any{
			"title":    "Good Song",
			"lyrics":   "words",
			"language": "en",
			"credits":  []map[string]any{{"name": "Someone", "role": "composer"}},
			"recordings": []map[string]any{{
				"youtube_url":  "https://youtu.be/dQw4w9WgXcQ",
				"release_year": 1997,
				"is_first":     true,
				"performers":   []map[string]any{{"name": "Someone Else", "position": 0}},
			}},
		}, 201},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := h.do("POST", "/api/v1/songs", token, tt.body)
			if resp.StatusCode != tt.want {
				body, _ := io.ReadAll(resp.Body)
				t.Errorf("status = %d, want %d\nbody: %s", resp.StatusCode, tt.want, body)
			}
		})
	}
}

// A YouTube link must be stored canonically so tracking parameters and
// shortened forms do not accumulate in the catalog.
//
// Asserted on the recording that carries it and on the song's copy, because the
// two are written by different things now — the handler canonicalizes, and a
// trigger copies. Either one alone leaves the other free to hold a raw link.
func TestYouTubeURLIsCanonicalized(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("contrib@example.com", store.RoleContributor)

	const canonical = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
	resp := h.do("POST", "/api/v1/songs", token, map[string]any{
		"title": "Linked",
		"recordings": []map[string]any{{
			"youtube_url": "https://youtu.be/dQw4w9WgXcQ?t=42&si=tracking",
			"is_first":    true,
		}},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}

	song := decode[store.Song](t, resp)
	if len(song.Recordings) != 1 {
		t.Fatalf("recordings = %v, want one", song.Recordings)
	}
	rec := song.Recordings[0]
	if rec.YouTubeURL == nil || *rec.YouTubeURL != canonical {
		t.Errorf("recording youtube_url = %v, want the canonical watch URL", rec.YouTubeURL)
	}
	if rec.YouTubeVideoID == nil || *rec.YouTubeVideoID != "dQw4w9WgXcQ" {
		t.Errorf("recording youtube_video_id = %v, want the extracted id", rec.YouTubeVideoID)
	}

	if song.YouTubeURL == nil || *song.YouTubeURL != canonical {
		t.Errorf("song youtube_url = %v, want the first recording's copy", song.YouTubeURL)
	}
	if song.YouTubeVideoID == nil || *song.YouTubeVideoID != "dQw4w9WgXcQ" {
		t.Errorf("song youtube_video_id = %v, want the first recording's copy", song.YouTubeVideoID)
	}
}

// The song's year and link are the first recording's, and they have to follow it
// — including down to nothing when the last recording goes. Nothing in the API
// writes those three columns, so this is what says the trigger is doing it.
func TestSongColumnsFollowRecordingEdits(t *testing.T) {
	h := newHarness(t)
	owner, token := h.userAndToken("contrib@example.com", store.RoleContributor)

	resp := h.do("POST", "/api/v1/songs", token, map[string]any{
		"title":      "Tracked",
		"recordings": []map[string]any{{"release_year": 1964, "is_first": true}},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d, want 201", resp.StatusCode)
	}
	song := decode[store.Song](t, resp)
	if song.ReleaseYear == nil || *song.ReleaseYear != 1964 {
		t.Fatalf("release_year = %v, want 1964", song.ReleaseYear)
	}
	_ = owner
	path := "/api/v1/songs/" + song.ID.String()

	t.Run("editing the recording's year moves the song's", func(t *testing.T) {
		resp := h.do("PATCH", path, token, map[string]any{
			"recordings": []map[string]any{{"release_year": 1971, "is_first": true}},
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		patched := decode[store.Song](t, resp)
		if patched.ReleaseYear == nil || *patched.ReleaseYear != 1971 {
			t.Errorf("release_year = %v, want 1971", patched.ReleaseYear)
		}
	})

	// An explicit empty array is "remove them all", and the song then has no
	// year at all — it never had one of its own to fall back on.
	t.Run("clearing the recordings clears the copies", func(t *testing.T) {
		resp := h.do("PATCH", path, token, map[string]any{"recordings": []map[string]any{}})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		patched := decode[store.Song](t, resp)
		if len(patched.Recordings) != 0 {
			t.Errorf("recordings = %v, want none", patched.Recordings)
		}
		if patched.ReleaseYear != nil || patched.YouTubeURL != nil || patched.YouTubeVideoID != nil {
			t.Errorf("song kept year=%v url=%v id=%v with no recording behind them",
				patched.ReleaseYear, patched.YouTubeURL, patched.YouTubeVideoID)
		}
	})
}

// The catalog holds links this API would refuse: the importer stores youtube_url
// verbatim and sets the id only when it parses, so its rows can carry a URL no
// write path here accepts. Every field on such a song was then uneditable —
// merge fills the omitted link in from the stored song and validation answered
// 422 naming a field the caller never sent, so fixing a typo in the lyrics meant
// clearing the link as well.
func TestPatchKeepsAnUnparseableStoredYouTubeURL(t *testing.T) {
	h := newHarness(t)
	owner, token := h.userAndToken("contrib@example.com", store.RoleContributor)

	// Stand in for the importer: a URL that does not parse, and so no id beside
	// it. The store carries the two columns independently and validates neither
	// — the same bare INSERT the importer does — so it can plant the row no API
	// write path would accept, which is the whole premise of this test.
	const stored = "https://youtube.com/watch?feature=share"
	song, err := h.store.CreateSong(context.Background(), store.SongInput{
		Title: "Imported", Lyrics: "first take", Language: "el",
		Recordings: []store.RecordingInput{{YouTubeURL: ptr(stored), IsFirst: true}},
	}, owner.ID)
	if err != nil {
		t.Fatalf("plant the imported row: %v", err)
	}
	path := "/api/v1/songs/" + song.ID.String()

	// Both halves of the trap, and they fail for different reasons: a patch that
	// leaves the recordings out has them filled in by merge, while the editor
	// hydrates the field from the stored value and sends the whole record every
	// save. The second is also what says the match is made on the URL string,
	// since the recording it arrives under has no id the caller could name.
	for _, tc := range []struct {
		name string
		body map[string]any
	}{
		{"omitting the recordings", map[string]any{"title": "Lyrics fixed"}},
		{"resending the link unchanged", map[string]any{
			"title":      "Fixed again",
			"recordings": []map[string]any{{"youtube_url": stored, "is_first": true}},
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := h.do("PATCH", path, token, tc.body)
			if resp.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(resp.Body)
				t.Fatalf("status = %d, want 200: %s", resp.StatusCode, body)
			}

			patched := decode[store.Song](t, resp)
			// Each case patches a different title, which is what shows the write
			// landed rather than the request merely being accepted. The
			// expectation is read back out of the body that was sent, so the
			// title is written once and the two cannot drift apart.
			if want, _ := tc.body["title"].(string); patched.Title != want {
				t.Errorf("title = %q, want %q", patched.Title, want)
			}
			if len(patched.Recordings) != 1 {
				t.Fatalf("recordings = %v, want the one that was there", patched.Recordings)
			}
			// Carried through exactly as stored: there is no id to canonicalize
			// from, so anything else here would be rewriting the catalog.
			rec := patched.Recordings[0]
			if rec.YouTubeURL == nil || *rec.YouTubeURL != stored {
				t.Errorf("youtube_url = %v, want it left at %q", rec.YouTubeURL, stored)
			}
			if rec.YouTubeVideoID != nil {
				t.Errorf("youtube_video_id = %v, want it still absent", rec.YouTubeVideoID)
			}
		})
	}

	// The exemption is for the value already stored, not for bad links in
	// general — a link the caller actually chose is still refused.
	t.Run("a different unrecognizable link is still refused", func(t *testing.T) {
		resp := h.do("PATCH", path, token, map[string]any{
			"recordings": []map[string]any{{"youtube_url": "https://vimeo.com/123"}},
		})
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422", resp.StatusCode)
		}
	})

	// And a create is never exempted: there is no stored song to have kept the
	// value, so the same string the PATCHes carry through is refused here.
	t.Run("the same link is refused on a create", func(t *testing.T) {
		resp := h.do("POST", "/api/v1/songs", token, map[string]any{
			"title":      "Fresh",
			"recordings": []map[string]any{{"youtube_url": stored}},
		})
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422", resp.StatusCode)
		}
	})
}

func TestRegistration(t *testing.T) {
	t.Run("creates the account and the local record", func(t *testing.T) {
		h := newHarness(t)

		resp := h.do("POST", "/api/v1/auth/register", "", map[string]any{
			"email": "New.User@Example.com", "password": "s3cret-password",
			"display_name": "New User",
		})
		if resp.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("status = %d, want 201\nbody: %s", resp.StatusCode, body)
		}

		user := decode[store.User](t, resp)
		if user.Email != "new.user@example.com" {
			t.Errorf("email = %q, want it normalized to lowercase", user.Email)
		}
		if user.Role != store.RoleUser {
			t.Errorf("role = %q, want %q", user.Role, store.RoleUser)
		}
		if len(h.prelude.Passwords) != 1 {
			t.Errorf("expected the password to have been set in Prelude")
		}
	})

	t.Run("bootstrap email registers as admin", func(t *testing.T) {
		h := newHarness(t, "boss@example.com")

		resp := h.do("POST", "/api/v1/auth/register", "", map[string]any{
			"email": "boss@example.com", "password": "s3cret-password",
		})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("status = %d, want 201", resp.StatusCode)
		}
		if user := decode[store.User](t, resp); user.Role != store.RoleAdmin {
			t.Errorf("role = %q, want %q", user.Role, store.RoleAdmin)
		}
	})

	t.Run("duplicate email is a conflict", func(t *testing.T) {
		h := newHarness(t)
		body := map[string]any{"email": "dupe@example.com", "password": "s3cret-password"}

		if resp := h.do("POST", "/api/v1/auth/register", "", body); resp.StatusCode != 201 {
			t.Fatalf("first registration status = %d, want 201", resp.StatusCode)
		}
		if resp := h.do("POST", "/api/v1/auth/register", "", body); resp.StatusCode != 409 {
			t.Errorf("second registration status = %d, want 409", resp.StatusCode)
		}
	})

	t.Run("validation", func(t *testing.T) {
		h := newHarness(t)
		tests := []struct {
			name string
			body map[string]any
			want int
		}{
			{"bad email", map[string]any{"email": "not-an-email", "password": "s3cret-password"}, 422},
			{"empty email", map[string]any{"email": "", "password": "s3cret-password"}, 422},
			{"short password", map[string]any{"email": "a@example.com", "password": "short"}, 422},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				if resp := h.do("POST", "/api/v1/auth/register", "", tt.body); resp.StatusCode != tt.want {
					t.Errorf("status = %d, want %d", resp.StatusCode, tt.want)
				}
			})
		}
	})
}

// If setting the password fails, the half-created Prelude account must be
// removed. Otherwise the email exists with no password: the user can neither
// sign in nor register again, and only an operator can unstick it.
func TestRegistrationRollsBackOrphanedAccount(t *testing.T) {
	h := newHarness(t)
	h.prelude.FailSetPassword = prelude.ErrUpstream

	resp := h.do("POST", "/api/v1/auth/register", "", map[string]any{
		"email": "doomed@example.com", "password": "s3cret-password",
	})
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}

	if !h.prelude.CalledWith("DeleteUser") {
		t.Error("expected the partially created user to be deleted")
	}
	if orphans := h.prelude.Orphans(); len(orphans) != 0 {
		t.Errorf("orphaned accounts remain: %v", orphans)
	}

	// The address must be usable again once the rollback has run.
	h.prelude.FailSetPassword = nil
	resp = h.do("POST", "/api/v1/auth/register", "", map[string]any{
		"email": "doomed@example.com", "password": "s3cret-password",
	})
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		t.Errorf("retry status = %d, want 201\nbody: %s", resp.StatusCode, body)
	}
}

// users.email is UNIQUE and is not the upsert's conflict target, so a local row
// holding the address under a different Prelude id is a violation provisioning
// cannot absorb. It used to be reported as a plain conflict *after* the Prelude
// account had been created and given a password, and that account was then left
// in place on the promise that the next sign-in would provision the local row —
// which fails on the same constraint every time. The address ended up carrying
// an unusable Prelude identity per attempt, and every later sign-in answered 500.
func TestRegisteringAnAddressHeldByAnotherAccount(t *testing.T) {
	h := newHarness(t)

	// The stale row: a Prelude account deleted and recreated, or a database
	// restored from a backup older than the account, leaves exactly this.
	h.user("taken@example.com", store.RoleUser)
	before := len(h.prelude.Users)

	// Mixed case on purpose — normalization is what makes this collide at all.
	resp := h.do("POST", "/api/v1/auth/register", "", map[string]any{
		"email": "Taken@Example.com", "password": "s3cret-password",
	})
	if resp.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want 409\nbody: %s", resp.StatusCode, body)
	}

	// The account made for this attempt cannot ever sign in, so leaving it would
	// add another on every retry.
	if got := len(h.prelude.Users); got != before {
		t.Errorf("prelude users = %d, want %d — the new account was left behind", got, before)
	}
}

// The same collision from the other side: an account that exists in Prelude and
// signs in normally, whose address a local row already holds. Provisioning is
// what the just-in-time path is for, so this is the one failure there that no
// later request can clear — and answering "Unable to provision your account"
// sent whoever read it looking for an outage.
func TestSignInWhenAnotherAccountHoldsTheAddress(t *testing.T) {
	h := newHarness(t)
	h.user("taken@example.com", store.RoleUser)

	token := h.issuer.Sign(t, testutil.TokenOptions{
		UserID: "usr_a_different_account", Email: "taken@example.com",
	})

	resp := h.do("GET", "/api/v1/me", token, nil)
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409\nbody: %s", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "another account") {
		t.Errorf("body = %s, want it to name the address being held elsewhere", body)
	}
}

func TestRegistrationRateLimited(t *testing.T) {
	h := newHarness(t)

	var limited bool
	for i := range 10 {
		resp := h.do("POST", "/api/v1/auth/register", "", map[string]any{
			"email":    "rate" + string(rune('a'+i)) + "@example.com",
			"password": "s3cret-password",
		})
		if resp.StatusCode == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Error("expected the registration endpoint to rate limit repeated attempts")
	}
}

// signUp registers an account over the API and returns it with a bearer token —
// the state a real user is in when the verification screen first renders.
//
// scopes go on the token, which is how a completed step-up challenge arrives:
// pass EmailVerifyScope to play the part of a user who has just entered the
// code Prelude emailed them.
func (h *harness) signUp(email string, scopes ...string) (*store.User, string) {
	h.t.Helper()

	resp := h.do("POST", "/api/v1/auth/register", "", map[string]any{
		"email": email, "password": "s3cret-password",
	})
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		h.t.Fatalf("register status = %d, want 201\nbody: %s", resp.StatusCode, body)
	}
	created := decode[store.User](h.t, resp)

	// The Prelude identifier is not serialized, so the token has to be minted
	// from the stored record rather than the response.
	user, err := h.store.GetUser(context.Background(), created.ID)
	if err != nil {
		h.t.Fatalf("load registered user: %v", err)
	}
	return user, h.issuer.Sign(h.t, testutil.TokenOptions{
		UserID: user.PreludeUserID, Email: user.Email, Scopes: scopes})
}

func TestEmailVerification(t *testing.T) {
	const email = "verify.me@example.com"

	t.Run("registration leaves the account unverified", func(t *testing.T) {
		h := newHarness(t)

		user, _ := h.signUp(email)
		if user.EmailVerified() {
			t.Error("a new account must start unverified")
		}
	})

	// The grant is the whole proof. It is a claim inside a signature only
	// Prelude can produce, which is why this endpoint can take the caller's
	// word for nothing else — there is no code in the request at all.
	t.Run("a granted scope confirms the address and opens the account", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.signUp(email, api.EmailVerifyScope)

		resp := h.do("POST", "/api/v1/auth/verify-email", token, nil)
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("status = %d, want 200\nbody: %s", resp.StatusCode, body)
		}
		if user := decode[store.User](t, resp); !user.EmailVerified() {
			t.Error("the response should report the address as verified")
		}

		// The point of verifying: a route that was refused a moment ago works.
		if resp := h.do("POST", "/api/v1/lists", token,
			map[string]any{"name": "First List"}); resp.StatusCode != http.StatusCreated {
			t.Errorf("create list after verifying = %d, want 201", resp.StatusCode)
		}
	})

	// A session that never completed the challenge is the ordinary state of
	// every signed-in visitor, so this must not read as a broken session: 403,
	// because a 401 would send the client off to refresh a token that is fine.
	t.Run("a token without the scope cannot verify", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.signUp(email)

		resp := h.do("POST", "/api/v1/auth/verify-email", token, nil)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", resp.StatusCode)
		}

		if me := decode[store.User](t, h.do("GET", "/api/v1/me", token, nil)); me.EmailVerified() {
			t.Error("an ungranted request must not verify the address")
		}
	})

	// A scope for something else is not a scope for this.
	t.Run("an unrelated scope cannot verify", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.signUp(email, "prld:pwd:write")

		if resp := h.do("POST", "/api/v1/auth/verify-email", token, nil); resp.StatusCode != http.StatusForbidden {
			t.Errorf("status = %d, want 403", resp.StatusCode)
		}
	})

	// The grant outlives the request that spent it, and a second tab or a
	// double submit must not be reported as a failure.
	t.Run("verifying twice is idempotent", func(t *testing.T) {
		h := newHarness(t)
		user, token := h.signUp(email, api.EmailVerifyScope)

		first := decode[store.User](t, h.do("POST", "/api/v1/auth/verify-email", token, nil))
		second := decode[store.User](t, h.do("POST", "/api/v1/auth/verify-email", token, nil))

		if !second.EmailVerified() {
			t.Fatal("second call should still report the account as verified")
		}
		if !first.EmailVerifiedAt.Equal(*second.EmailVerifiedAt) {
			t.Errorf("verification time moved: %v then %v",
				first.EmailVerifiedAt, second.EmailVerifiedAt)
		}
		_ = user
	})

	// Registration makes no upstream verification call of any kind: the code is
	// sent by Prelude to the browser's challenge, never by this API.
	t.Run("registration does not talk to prelude about codes", func(t *testing.T) {
		h := newHarness(t)
		h.signUp(email)

		for _, call := range h.prelude.Calls {
			if call != "CreateUser" && call != "SetPassword" {
				t.Errorf("unexpected prelude call during registration: %q", call)
			}
		}
	})
}

// TestUnverifiedAccountIsGated walks the gate from both sides.
//
// With an *admin* principal, because the gate is not a role check and has to
// hold for the role that passes every other one. And over the exemptions as
// well as the refusals, since the exemption list is written at the mount point:
// a route added to the wrong group stops needing verification silently, because
// it still works.
func TestUnverifiedAccountIsGated(t *testing.T) {
	h := newHarness(t)

	admin := h.unverifiedUser("unverified.admin@example.com", store.RoleAdmin)
	token := h.sign(admin)

	refused := []struct {
		method, path string
		body         any
	}{
		{"PATCH", "/api/v1/me", map[string]any{"display_name": "Not yet"}},
		{"POST", "/api/v1/me/avatar", nil},
		{"DELETE", "/api/v1/me/avatar", nil},
		{"GET", "/api/v1/lists", nil},
		{"POST", "/api/v1/lists", map[string]any{"name": "Not yet"}},
		{"POST", "/api/v1/songs", map[string]any{"title": "N", "lyrics": "x", "language": "el"}},
		{"POST", "/api/v1/people", map[string]any{"name": "Nobody"}},
		{"GET", "/api/v1/admin/users", nil},
	}
	for _, tt := range refused {
		// 403 and never 401: the session is perfectly valid, and a 401 would
		// send the client off to refresh a token that is already fine.
		if resp := h.do(tt.method, tt.path, token, tt.body); resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s %s unverified = %d, want 403", tt.method, tt.path, resp.StatusCode)
		}
	}

	// The exemptions, which are the entire list: who am I, and record the
	// challenge I just completed. Anything more here and the verification screen
	// would be reachable by an account that has no way to leave it.
	if resp := h.do("GET", "/api/v1/me", token, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("GET /me unverified = %d, want 200", resp.StatusCode)
	}

	scoped := h.issuer.Sign(t, testutil.TokenOptions{
		UserID: admin.PreludeUserID, Email: admin.Email, Scopes: []string{api.EmailVerifyScope}})
	if resp := h.do("POST", "/api/v1/auth/verify-email", scoped, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("POST /auth/verify-email unverified = %d, want 200", resp.StatusCode)
	}
}

// Guests are unaffected: verification gates an account, not the catalog.
func TestGuestBrowsingIsUnaffectedByVerification(t *testing.T) {
	h := newHarness(t)
	h.seedSong(nil, "Public Song")

	if resp := h.do("GET", "/api/v1/songs", "", nil); resp.StatusCode != http.StatusOK {
		t.Errorf("guest browse = %d, want 200", resp.StatusCode)
	}
}

func TestSearchEndpointReturnsSnippets(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("contrib@example.com", store.RoleContributor)

	resp := h.do("POST", "/api/v1/songs", token, map[string]any{
		"title":    "Θάλασσα",
		"lyrics":   "Στης θάλασσας τα βάθη",
		"language": "el",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("seed status = %d, want 201", resp.StatusCode)
	}

	resp = h.do("GET", "/api/v1/songs?q=%CE%B8%CE%AC%CE%BB%CE%B1%CF%83%CF%83%CE%B1%CF%82", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("search status = %d, want 200", resp.StatusCode)
	}

	result := decode[struct {
		Data []store.Song `json:"data"`
	}](t, resp)
	if len(result.Data) == 0 {
		t.Fatal("expected a search result")
	}
	if result.Data[0].Snippet == nil || !strings.Contains(*result.Data[0].Snippet, store.SnippetStartSel) {
		t.Errorf("snippet = %v, want a highlighted excerpt", result.Data[0].Snippet)
	}
}

// PATCH must treat an omitted field as "unchanged". Passing a nil pointer
// straight through to the store would blank every field the caller left out.
func TestPatchSemanticsPreserveOmittedFields(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("patcher@example.com", store.RoleUser)

	if resp := h.do("PATCH", "/api/v1/me", token, map[string]any{"display_name": "Original"}); resp.StatusCode != 200 {
		t.Fatalf("set display name status = %d, want 200", resp.StatusCode)
	}

	t.Run("empty patch leaves the value alone", func(t *testing.T) {
		resp := h.do("PATCH", "/api/v1/me", token, map[string]any{})
		if resp.StatusCode != 200 {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		user := decode[store.User](t, resp)
		if user.DisplayName == nil || *user.DisplayName != "Original" {
			t.Errorf("display_name = %v, want it preserved", user.DisplayName)
		}
	})

	t.Run("explicit null clears the value", func(t *testing.T) {
		resp := h.do("PATCH", "/api/v1/me", token, map[string]any{"display_name": nil})
		if resp.StatusCode != 200 {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if user := decode[store.User](t, resp); user.DisplayName != nil {
			t.Errorf("display_name = %v, want nil", *user.DisplayName)
		}
	})
}

// The same tri-state rule applies to lists, where an omitted is_public would
// otherwise silently republish or unpublish a list on an unrelated rename.
// A song PATCH carrying one field must not blank the rest. This is the endpoint
// where getting it wrong is destructive rather than merely annoying: the lyrics
// body, every credit, and every genre all live on the same record, and the
// response to the request that erased them is a 200.
func TestSongPatchPreservesOmittedFields(t *testing.T) {
	h := newHarness(t)
	author, token := h.userAndToken("author@example.com", store.RoleContributor)

	person, err := h.store.UpsertPerson(context.Background(), "Μίκης Θεοδωράκης")
	if err != nil {
		t.Fatalf("upsert person: %v", err)
	}
	genre, err := h.store.CreateGenre(context.Background(), "Έντεχνο")
	if err != nil {
		t.Fatalf("create genre: %v", err)
	}

	singer, err := h.store.UpsertPerson(context.Background(), "Γιώργος Νταλάρας")
	if err != nil {
		t.Fatalf("upsert person: %v", err)
	}

	created, err := h.store.CreateSong(context.Background(), store.SongInput{
		Title:    "Θάλασσα Πλατιά",
		Lyrics:   "Μια μέρα στη θάλασσα",
		Language: "el",
		Notes:    ptr("A note worth keeping."),
		Credits:  []store.Credit{{PersonID: person.ID, Role: store.CreditComposer}},
		GenreIDs: []uuid.UUID{genre.ID},
		Recordings: []store.RecordingInput{{
			ReleaseYear: ptr(1964),
			IsFirst:     true,
			Performers:  []store.RecordingPerformer{{PersonID: singer.ID}},
		}},
	}, author.ID)
	if err != nil {
		t.Fatalf("create song: %v", err)
	}
	path := "/api/v1/songs/" + created.ID.String()

	resp := h.do("PATCH", path, token, map[string]any{"title": "Θάλασσα Πλατιά (edit)"})
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want 200\nbody: %s", resp.StatusCode, body)
	}

	patched := decode[store.Song](t, resp)
	if patched.Title != "Θάλασσα Πλατιά (edit)" {
		t.Errorf("title = %q, want the patched value", patched.Title)
	}
	// A PATCH answers with the whole song, body included — the client caches
	// this response as the song, so a nil here would blank the page it came from.
	if patched.Lyrics == nil || *patched.Lyrics != "Μια μέρα στη θάλασσα" {
		t.Errorf("lyrics = %v, want them untouched", patched.Lyrics)
	}
	if patched.Notes == nil || *patched.Notes != "A note worth keeping." {
		t.Errorf("notes = %v, want them untouched", patched.Notes)
	}
	if len(patched.Credits) != 1 {
		t.Errorf("credits = %d, want the original 1 preserved", len(patched.Credits))
	}
	if len(patched.Genres) != 1 {
		t.Errorf("genres = %d, want the original 1 preserved", len(patched.Genres))
	}
	// The recordings are the deepest thing merge has to restate, performers and
	// all: a shallow restatement leaves the recording with nobody on it.
	if len(patched.Recordings) != 1 {
		t.Fatalf("recordings = %d, want the original 1 preserved", len(patched.Recordings))
	}
	if len(patched.Recordings[0].Performers) != 1 {
		t.Errorf("performers = %d, want the original 1 preserved",
			len(patched.Recordings[0].Performers))
	}
	if patched.Recordings[0].ReleaseYear == nil || *patched.Recordings[0].ReleaseYear != 1964 {
		t.Errorf("recording year = %v, want it untouched", patched.Recordings[0].ReleaseYear)
	}

	// An explicit empty list is the one way to say "remove them all", and must
	// still be distinguishable from omitting the key.
	for _, field := range []string{"credits", "recordings"} {
		resp = h.do("PATCH", path, token, map[string]any{field: []any{}})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("clearing %s: status = %d, want 200", field, resp.StatusCode)
		}
		cleared := decode[store.Song](t, resp)
		if field == "credits" && len(cleared.Credits) != 0 {
			t.Errorf("credits = %d, want an explicit [] to clear them", len(cleared.Credits))
		}
		if field == "recordings" && len(cleared.Recordings) != 0 {
			t.Errorf("recordings = %d, want an explicit [] to clear them", len(cleared.Recordings))
		}
	}
}

func ptr[T any](v T) *T { return &v }

func TestListPatchPreservesOmittedFields(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("listpatcher@example.com", store.RoleUser)

	list := h.seedList(token, map[string]any{
		"name": "Original Name", "description": "Original description", "is_public": true,
	})
	path := "/api/v1/lists/" + list.ID.String()

	resp := h.do("PATCH", path, token, map[string]any{"name": "Renamed"})
	if resp.StatusCode != 200 {
		t.Fatalf("patch status = %d, want 200", resp.StatusCode)
	}

	updated := decode[store.List](t, resp)
	if updated.Name != "Renamed" {
		t.Errorf("name = %q, want %q", updated.Name, "Renamed")
	}
	if !updated.IsPublic {
		t.Error("is_public was cleared by a patch that did not mention it")
	}
	if updated.Description == nil || *updated.Description != "Original description" {
		t.Errorf("description = %v, want it preserved", updated.Description)
	}
}

// A whitespace-only rename has to be refused, not silently applied and not a
// 500. Getting there crosses two mechanisms that are easy to change apart:
// optionalString trims on decode and turns "   " into the same nil it uses for
// an explicit null, and the PATCH handler is what decides that a cleared name
// is an error rather than a no-op. Neither is obvious from the other's file.
func TestWhitespaceRenameIsRejected(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("blanknamer@example.com", store.RoleUser)

	list := h.seedList(token, map[string]any{"name": "Keeps Its Name"})

	resp := h.do("PATCH", "/api/v1/lists/"+list.ID.String(), token, map[string]any{"name": "   "})
	if resp.StatusCode != 422 {
		t.Fatalf("patch status = %d, want 422", resp.StatusCode)
	}
}
