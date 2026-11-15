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

// sign mints a bearer token for a stored user; every test principal goes
// through it so token claims cannot drift.
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

// doRaw sends a non-JSON body, such as an avatar upload. `do` builds on it.
func (h *harness) doRaw(method, path, token, contentType string, body []byte) *http.Response {
	h.t.Helper()

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(h.t.Context(), method, h.server.URL+path, reader)
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

// doConditional sends a GET with If-None-Match.
func (h *harness) doConditional(path, etag string) *http.Response {
	h.t.Helper()

	req, err := http.NewRequestWithContext(h.t.Context(), http.MethodGet, h.server.URL+path, http.NoBody)
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

// seedList creates a list over the API and returns it.
func (h *harness) seedList(token string, body map[string]any) store.List {
	h.t.Helper()

	resp := h.do("POST", "/api/v1/lists", token, body)
	if resp.StatusCode != http.StatusCreated {
		h.t.Fatalf("seed list status = %d, want 201", resp.StatusCode)
	}
	return decode[store.List](h.t, resp)
}

// user provisions a verified account; unverified ones are refused almost
// everywhere.
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

	// Owned by a separate user, so every role copies it as a stranger.
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
			// Each role copies it as a stranger, under its own name.
			guest: 401, user: 201, contributor: 201, admin: 201,
		},
		{
			name: "list all users", method: "GET", path: "/api/v1/admin/users",
			guest: 401, user: 403, contributor: 403, admin: 200,
		},
		{
			name: "read a profile picture", method: "GET",
			path: "/api/v1/users/" + uuid.NewString() + "/avatar",
			// Public (an <img> sends no token): nobody has a picture, so every
			// role gets 404. A guest 401 would mean it was mounted behind auth.
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
		if resp := h.do("PATCH", "/api/v1/songs/"+songID, authorTok, edit); resp.StatusCode != http.StatusOK {
			t.Errorf("status = %d, want 200", resp.StatusCode)
		}
	})

	t.Run("another contributor may not", func(t *testing.T) {
		if resp := h.do("PATCH", "/api/v1/songs/"+songID, otherTok, edit); resp.StatusCode != http.StatusForbidden {
			t.Errorf("status = %d, want 403", resp.StatusCode)
		}
	})

	t.Run("admin may edit anything", func(t *testing.T) {
		if resp := h.do("PATCH", "/api/v1/songs/"+songID, adminTok, edit); resp.StatusCode != http.StatusOK {
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
			UserID: "usr_never_seen", Email: "stranger@example.com",
		})

		resp := h.do("GET", "/api/v1/me", token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		user := decode[store.User](t, resp)
		if user.Role != store.RoleUser {
			t.Errorf("role = %q, want %q", user.Role, store.RoleUser)
		}
	})

	t.Run("bootstrap email becomes admin", func(t *testing.T) {
		token := h.issuer.Sign(t, testutil.TokenOptions{
			UserID: "usr_boss", Email: "boss@example.com",
		})

		resp := h.do("GET", "/api/v1/me", token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		user := decode[store.User](t, resp)
		if user.Role != store.RoleAdmin {
			t.Errorf("role = %q, want %q", user.Role, store.RoleAdmin)
		}
	})

	t.Run("missing email claim is refused", func(t *testing.T) {
		token := h.issuer.Sign(t, testutil.TokenOptions{
			UserID: "usr_no_email", OmitEmail: true,
		})

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

	if resp := h.do("GET", path, ownerTok, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("owner read = %d, want 200", resp.StatusCode)
	}
	if resp := h.do("GET", path, strangerTok, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stranger read of private list = %d, want 404", resp.StatusCode)
	}
	if resp := h.do("GET", path, "", nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("guest read of private list = %d, want 404", resp.StatusCode)
	}

	if resp := h.do("PATCH", path, ownerTok, map[string]any{"is_public": true}); resp.StatusCode != http.StatusOK {
		t.Fatalf("publish status = %d, want 200", resp.StatusCode)
	}

	if resp := h.do("GET", path, "", nil); resp.StatusCode != http.StatusOK {
		t.Errorf("guest read of public list = %d, want 200", resp.StatusCode)
	}

	// Another user still may not modify it.
	if resp := h.do("PATCH", path, strangerTok, map[string]any{"name": "Hijacked"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stranger write = %d, want 404", resp.StatusCode)
	}
}

// Pins how reorder treats partial, unknown and repeated ids.
func TestReorderList(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("curator@example.com", store.RoleUser)

	path := "/api/v1/lists/" + h.seedList(token, map[string]any{"name": "In Order"}).ID.String()

	songs := make([]string, 4)
	for i := range songs {
		songs[i] = h.seedSong(nil, fmt.Sprintf("Song %d", i))
		if resp := h.do("PUT", path+"/songs/"+songs[i], token, nil); resp.StatusCode != http.StatusNoContent {
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
		listSongs := decode[store.List](t, resp).Songs
		got := make([]int, 0, len(listSongs))
		for _, song := range listSongs {
			got = append(got, slices.Index(songs, song.ID.String()))
		}
		return got
	}

	reorder := func(ids ...string) *http.Response {
		t.Helper()
		return h.do("POST", path+"/reorder", token, map[string]any{"song_ids": ids})
	}

	t.Run("a full payload is applied verbatim", func(t *testing.T) {
		if resp := reorder(songs[3], songs[1], songs[0], songs[2]); resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if got := order(); !slices.Equal(got, []int{3, 1, 0, 2}) {
			t.Errorf("order = %v, want [3 1 0 2]", got)
		}
	})

	// A stale client cannot drop songs it never knew about.
	t.Run("songs left out keep their relative order at the end", func(t *testing.T) {
		if resp := reorder(songs[2], songs[0]); resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if got := order(); !slices.Equal(got, []int{2, 0, 3, 1}) {
			t.Errorf("order = %v, want [2 0 3 1] (3 before 1, as they already were)", got)
		}
	})

	t.Run("a song outside the list is rejected and changes nothing", func(t *testing.T) {
		before := order()
		stranger := h.seedSong(nil, "Not In This List")

		if resp := reorder(songs[0], stranger, songs[1]); resp.StatusCode != http.StatusNotFound {
			t.Errorf("status = %d, want 404", resp.StatusCode)
		}
		// One transaction: the valid ids must not have been written either.
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
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("status = %d, want 404", resp.StatusCode)
		}
	})
}

// A copy belongs to whoever took it, keeps the curated order, and starts private.
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
		if resp := h.do("PUT", path+"/songs/"+songID, ownerTok, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("add song status = %d, want 204", resp.StatusCode)
		}
	}
	// Reordered first, so the copy must carry positions, not insertion order.
	if resp := h.do("POST", path+"/reorder", ownerTok, map[string]any{
		"song_ids": []string{second, first},
	}); resp.StatusCode != http.StatusOK {
		t.Fatalf("reorder status = %d, want 200", resp.StatusCode)
	}

	resp := h.do("POST", path+"/copy", strangerTok, map[string]any{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("copy status = %d, want 201", resp.StatusCode)
	}
	copied := decode[store.List](t, resp)

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

	// A second copy collides on the per-owner name index.
	resp = h.do("POST", path+"/copy", strangerTok, map[string]any{})
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("second copy status = %d, want 409", resp.StatusCode)
	}
	resp = h.do("POST", path+"/copy", strangerTok, map[string]any{"name": "Rebetika Nights (again)"})
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("renamed copy status = %d, want 201", resp.StatusCode)
	}

	// Editing the copy leaves the original alone.
	if resp := h.do("DELETE", "/api/v1/lists/"+copied.ID.String()+"/songs/"+first, strangerTok, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("remove from copy status = %d, want 204", resp.StatusCode)
	}
	if resp := h.do("GET", path, ownerTok, nil); decode[store.List](t, resp).ItemCount != 2 {
		t.Error("editing the copy changed the source list")
	}
}

// Copying a private list is 404, like reading it, so ids cannot be probed.
func TestCopyPrivateListIsNotFound(t *testing.T) {
	h := newHarness(t)

	ownerTok := h.tokenFor("private-owner@example.com", store.RoleUser)
	strangerTok := h.tokenFor("prober@example.com", store.RoleUser)

	path := "/api/v1/lists/" + h.seedList(ownerTok, map[string]any{"name": "Private Picks"}).ID.String() + "/copy"

	if resp := h.do("POST", path, strangerTok, map[string]any{}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("stranger copy of private list = %d, want 404", resp.StatusCode)
	}
	if resp := h.do("POST", path, "", map[string]any{}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("guest copy = %d, want 401", resp.StatusCode)
	}
	// The owner duplicating their own list needs a free name, but is allowed.
	if resp := h.do("POST", path, ownerTok, map[string]any{"name": "Private Picks Copy"}); resp.StatusCode != http.StatusCreated {
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

// The last admin cannot be demoted or deleted.
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

// manyRecordings and manyPerformers build oversized payloads for the cap cases.
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
		// Performing is not a credit role; performers belong on recordings.
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
		// One over maxRecordings and maxPerformers, spelled out because this
		// external test package cannot read them; change both together.
		{"too many recordings", map[string]any{
			"title":      "T",
			"recordings": manyRecordings(17),
		}, 422},
		{"too many performers across the recordings", map[string]any{
			"title":      "T",
			"recordings": []map[string]any{{"performers": manyPerformers(65)}},
		}, 422},
		// The link and year belong to recordings; at song level they are refused.
		{"a song-level youtube url", map[string]any{
			"title":       "T",
			"youtube_url": "https://youtu.be/dQw4w9WgXcQ",
		}, 400},
		{"a song-level release year", map[string]any{"title": "T", "release_year": 1964}, 400},
		{"unknown field", map[string]any{"title": "T", "color": "blue"}, 400},
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

// A YouTube link is stored canonically. Asserted on the recording (handler
// canonicalizes) and on the song's copy (trigger copies).
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

// The song's year and link follow the first recording, down to null when the
// last one goes. Only the trigger writes them.
func TestSongColumnsFollowRecordingEdits(t *testing.T) {
	h := newHarness(t)
	_, token := h.userAndToken("contrib@example.com", store.RoleContributor)

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

	// An explicit [] removes them all, and the song's copies go null.
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

// The importer can store links this API refuses; a PATCH that sends such a link
// back unchanged must still succeed. See CLAUDE.md "Recordings".
func TestPatchKeepsAnUnparseableStoredYouTubeURL(t *testing.T) {
	h := newHarness(t)
	owner, token := h.userAndToken("contrib@example.com", store.RoleContributor)

	// Stand in for the importer: the store validates neither column, so it can
	// plant an unparseable URL with no id.
	const stored = "https://youtube.com/watch?feature=share"
	song, err := h.store.CreateSong(context.Background(), store.SongInput{
		Title: "Imported", Lyrics: "first take", Language: "el",
		Recordings: []store.RecordingInput{{YouTubeURL: ptr(stored), IsFirst: true}},
	}, owner.ID)
	if err != nil {
		t.Fatalf("plant the imported row: %v", err)
	}
	path := "/api/v1/songs/" + song.ID.String()

	// Omitted recordings are filled in by merge; the editor resends the whole
	// record. The second also shows the match is on the URL string.
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
			// A distinct title per case shows the write landed.
			if want, _ := tc.body["title"].(string); patched.Title != want {
				t.Errorf("title = %q, want %q", patched.Title, want)
			}
			if len(patched.Recordings) != 1 {
				t.Fatalf("recordings = %v, want the one that was there", patched.Recordings)
			}
			// Carried through exactly as stored.
			rec := patched.Recordings[0]
			if rec.YouTubeURL == nil || *rec.YouTubeURL != stored {
				t.Errorf("youtube_url = %v, want it left at %q", rec.YouTubeURL, stored)
			}
			if rec.YouTubeVideoID != nil {
				t.Errorf("youtube_video_id = %v, want it still absent", rec.YouTubeVideoID)
			}
		})
	}

	// The exemption covers only the stored value.
	t.Run("a different unrecognizable link is still refused", func(t *testing.T) {
		resp := h.do("PATCH", path, token, map[string]any{
			"recordings": []map[string]any{{"youtube_url": "https://vimeo.com/123"}},
		})
		if resp.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf("status = %d, want 422", resp.StatusCode)
		}
	})

	// A create is never exempted.
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

		if resp := h.do("POST", "/api/v1/auth/register", "", body); resp.StatusCode != http.StatusCreated {
			t.Fatalf("first registration status = %d, want 201", resp.StatusCode)
		}
		if resp := h.do("POST", "/api/v1/auth/register", "", body); resp.StatusCode != http.StatusConflict {
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

// If setting the password fails, the half-created Prelude account is removed,
// or the address is burned.
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

// A local row holding the address under another Prelude id is a violation
// provisioning can never absorb, so the new Prelude account is rolled back.
func TestRegisteringAnAddressHeldByAnotherAccount(t *testing.T) {
	h := newHarness(t)

	// The stale row.
	h.user("taken@example.com", store.RoleUser)
	before := len(h.prelude.Users)

	// Mixed case: normalization is what makes this collide.
	resp := h.do("POST", "/api/v1/auth/register", "", map[string]any{
		"email": "Taken@Example.com", "password": "s3cret-password",
	})
	if resp.StatusCode != http.StatusConflict {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want 409\nbody: %s", resp.StatusCode, body)
	}

	if got := len(h.prelude.Users); got != before {
		t.Errorf("prelude users = %d, want %d — the new account was left behind", got, before)
	}
}

// The same collision on sign-in: JIT provisioning answers 409 naming the cause,
// not a generic provisioning failure.
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

// signUp registers an account over the API and returns it with a bearer token.
// Pass EmailVerifyScope to simulate a completed step-up challenge.
func (h *harness) signUp(scopes ...string) (*store.User, string) {
	h.t.Helper()

	resp := h.do("POST", "/api/v1/auth/register", "", map[string]any{
		"email": "verify.me@example.com", "password": "s3cret-password",
	})
	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		h.t.Fatalf("register status = %d, want 201\nbody: %s", resp.StatusCode, body)
	}
	created := decode[store.User](h.t, resp)

	// The Prelude id is not serialized, so read the stored record.
	user, err := h.store.GetUser(context.Background(), created.ID)
	if err != nil {
		h.t.Fatalf("load registered user: %v", err)
	}
	return user, h.issuer.Sign(h.t, testutil.TokenOptions{
		UserID: user.PreludeUserID, Email: user.Email, Scopes: scopes,
	})
}

func TestEmailVerification(t *testing.T) {
	t.Run("registration leaves the account unverified", func(t *testing.T) {
		h := newHarness(t)

		user, _ := h.signUp()
		if user.EmailVerified() {
			t.Error("a new account must start unverified")
		}
	})

	// The signed scope is the whole proof; there is no code in the request.
	t.Run("a granted scope confirms the address and opens the account", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.signUp(api.EmailVerifyScope)

		resp := h.do("POST", "/api/v1/auth/verify-email", token, nil)
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("status = %d, want 200\nbody: %s", resp.StatusCode, body)
		}
		if user := decode[store.User](t, resp); !user.EmailVerified() {
			t.Error("the response should report the address as verified")
		}

		if resp := h.do("POST", "/api/v1/lists", token,
			map[string]any{"name": "First List"}); resp.StatusCode != http.StatusCreated {
			t.Errorf("create list after verifying = %d, want 201", resp.StatusCode)
		}
	})

	// 403, not 401: a 401 makes the client refresh a token that is fine.
	t.Run("a token without the scope cannot verify", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.signUp()

		resp := h.do("POST", "/api/v1/auth/verify-email", token, nil)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", resp.StatusCode)
		}

		if me := decode[store.User](t, h.do("GET", "/api/v1/me", token, nil)); me.EmailVerified() {
			t.Error("an ungranted request must not verify the address")
		}
	})

	t.Run("an unrelated scope cannot verify", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.signUp("prld:pwd:write")

		if resp := h.do("POST", "/api/v1/auth/verify-email", token, nil); resp.StatusCode != http.StatusForbidden {
			t.Errorf("status = %d, want 403", resp.StatusCode)
		}
	})

	t.Run("verifying twice is idempotent", func(t *testing.T) {
		h := newHarness(t)
		user, token := h.signUp(api.EmailVerifyScope)

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

	// The code is between the browser and Prelude, never this API.
	t.Run("registration does not talk to prelude about codes", func(t *testing.T) {
		h := newHarness(t)
		h.signUp()

		for _, call := range h.prelude.Calls {
			if call != "CreateUser" && call != "SetPassword" {
				t.Errorf("unexpected prelude call during registration: %q", call)
			}
		}
	})
}

// TestUnverifiedAccountIsGated walks refusals and exemptions with an admin
// principal: the gate is not a role check. A route mounted in the wrong group
// silently stops needing verification.
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
		// 403, not 401.
		if resp := h.do(tt.method, tt.path, token, tt.body); resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s %s unverified = %d, want 403", tt.method, tt.path, resp.StatusCode)
		}
	}

	// The exemptions: GET /me and POST /auth/verify-email.
	if resp := h.do("GET", "/api/v1/me", token, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("GET /me unverified = %d, want 200", resp.StatusCode)
	}

	scoped := h.issuer.Sign(t, testutil.TokenOptions{
		UserID: admin.PreludeUserID, Email: admin.Email, Scopes: []string{api.EmailVerifyScope},
	})
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

// PATCH treats an omitted field as unchanged and an explicit null as clear.
func TestPatchSemanticsPreserveOmittedFields(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("patcher@example.com", store.RoleUser)

	if resp := h.do("PATCH", "/api/v1/me", token, map[string]any{"display_name": "Original"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("set display name status = %d, want 200", resp.StatusCode)
	}

	t.Run("empty patch leaves the value alone", func(t *testing.T) {
		resp := h.do("PATCH", "/api/v1/me", token, map[string]any{})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		user := decode[store.User](t, resp)
		if user.DisplayName == nil || *user.DisplayName != "Original" {
			t.Errorf("display_name = %v, want it preserved", user.DisplayName)
		}
	})

	t.Run("explicit null clears the value", func(t *testing.T) {
		resp := h.do("PATCH", "/api/v1/me", token, map[string]any{"display_name": nil})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		if user := decode[store.User](t, resp); user.DisplayName != nil {
			t.Errorf("display_name = %v, want nil", *user.DisplayName)
		}
	})
}

// A song PATCH carrying one field must not blank the rest.
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
	// The response includes lyrics: the client caches it as the song.
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
	// merge must restate recordings with their performers.
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

	// An explicit [] removes them all, unlike omitting the key.
	for _, tc := range []struct {
		field string
		count func(store.Song) int
	}{
		{"credits", func(s store.Song) int { return len(s.Credits) }},
		{"recordings", func(s store.Song) int { return len(s.Recordings) }},
	} {
		resp = h.do("PATCH", path, token, map[string]any{tc.field: []any{}})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("clearing %s: status = %d, want 200", tc.field, resp.StatusCode)
		}
		if n := tc.count(decode[store.Song](t, resp)); n != 0 {
			t.Errorf("%s = %d, want an explicit [] to clear them", tc.field, n)
		}
	}
}

func ptr[T any](v T) *T { return &v }

// An omitted is_public must not republish or unpublish a list on a rename.
func TestListPatchPreservesOmittedFields(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("listpatcher@example.com", store.RoleUser)

	list := h.seedList(token, map[string]any{
		"name": "Original Name", "description": "Original description", "is_public": true,
	})
	path := "/api/v1/lists/" + list.ID.String()

	resp := h.do("PATCH", path, token, map[string]any{"name": "Renamed"})
	if resp.StatusCode != http.StatusOK {
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

// A whitespace-only rename is a 422. It spans optionalString (trims "   " to
// nil) and the handler (a nil name is an error).
func TestWhitespaceRenameIsRejected(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("blanknamer@example.com", store.RoleUser)

	list := h.seedList(token, map[string]any{"name": "Keeps Its Name"})

	resp := h.do("PATCH", "/api/v1/lists/"+list.ID.String(), token, map[string]any{"name": "   "})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("patch status = %d, want 422", resp.StatusCode)
	}
}
