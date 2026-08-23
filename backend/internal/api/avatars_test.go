package api_test

import (
	"bytes"
	"image"
	"io"
	"net/http"
	"testing"

	"github.com/christos/lyrics/backend/internal/imaging"
	"github.com/christos/lyrics/backend/internal/store"
	"github.com/christos/lyrics/backend/internal/testutil"

	// Registers the JPEG decoder, so a test can assert that what came back is
	// one — which is the point of the API re-encoding every upload.
	_ "image/jpeg"
)

func TestProfilePictureLifecycle(t *testing.T) {
	h := newHarness(t)
	user, token := h.userAndToken("picture.owner@example.com", store.RoleUser)
	path := "/api/v1/users/" + user.ID.String() + "/avatar"

	if me := decode[store.User](t, h.do("GET", "/api/v1/me", token, nil)); me.AvatarUpdatedAt != nil {
		t.Fatalf("a new account starts with avatar_updated_at = %v, want null", me.AvatarUpdatedAt)
	}

	resp := h.doRaw("POST", "/api/v1/me/avatar", token, "image/png",
		testutil.SolidPNG(t, 64, 64, testutil.Opaque))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload = %d, want 200", resp.StatusCode)
	}
	uploaded := decode[store.User](t, resp)
	if uploaded.AvatarUpdatedAt == nil {
		t.Fatal("the upload response must carry the version the client caches against")
	}

	// Fetched as a guest, because that is what an <img> is: it does not go
	// through the API client and has no token to send.
	served := h.do("GET", path, "", nil)
	if served.StatusCode != http.StatusOK {
		t.Fatalf("guest GET picture = %d, want 200", served.StatusCode)
	}
	if got := served.Header.Get("Content-Type"); got != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg", got)
	}
	// Pinned as a literal, because this header is the whole of what a removal
	// can promise: `immutable`, or a year of freshness, leaves a removed picture
	// on other people's screens with nothing able to recall it.
	if got := served.Header.Get("Cache-Control"); got != "public, max-age=300" {
		t.Errorf("Cache-Control = %q, want public, max-age=300", got)
	}
	etag := served.Header.Get("ETag")
	if etag == "" {
		t.Error("a picture must be served with an ETag, or every page load re-downloads it")
	}

	// A PNG went up and a JPEG came back, which is what says the stored bytes
	// are the encoder's output rather than the file that was uploaded.
	body, err := io.ReadAll(served.Body)
	if err != nil {
		t.Fatalf("read served picture: %v", err)
	}
	if _, format, err := image.DecodeConfig(bytes.NewReader(body)); err != nil || format != "jpeg" {
		t.Errorf("served image decoded as (%q, %v), want jpeg", format, err)
	}

	if again := h.doConditional(path, etag); again.StatusCode != http.StatusNotModified {
		t.Errorf("conditional GET = %d, want 304", again.StatusCode)
	}

	// Replacing the picture has to move the version, or the cache-busting
	// parameter built from it keeps pointing at the old image.
	replaced := decode[store.User](t, h.doRaw("POST", "/api/v1/me/avatar", token, "image/png",
		testutil.SolidPNG(t, 32, 32, testutil.Opaque)))
	if replaced.AvatarUpdatedAt == nil || !replaced.AvatarUpdatedAt.After(*uploaded.AvatarUpdatedAt) {
		t.Errorf("replacing left avatar_updated_at at %v, want a later time than %v",
			replaced.AvatarUpdatedAt, uploaded.AvatarUpdatedAt)
	}
	if newETag := h.do("GET", path, "", nil).Header.Get("ETag"); newETag == etag {
		t.Error("a replaced picture must not keep the previous ETag")
	}

	removed := decode[store.User](t, h.do("DELETE", "/api/v1/me/avatar", token, nil))
	if removed.AvatarUpdatedAt != nil {
		t.Errorf("after removal avatar_updated_at = %v, want null", removed.AvatarUpdatedAt)
	}
	if gone := h.do("GET", path, "", nil); gone.StatusCode != http.StatusNotFound {
		t.Errorf("GET a removed picture = %d, want 404", gone.StatusCode)
	}

	// Removing twice is a double tap on a control that was there a moment ago,
	// not an error.
	if second := h.do("DELETE", "/api/v1/me/avatar", token, nil); second.StatusCode != http.StatusOK {
		t.Errorf("second removal = %d, want 200", second.StatusCode)
	}
}

func TestProfilePictureRefusals(t *testing.T) {
	h := newHarness(t)
	token := h.tokenFor("picture.refusals@example.com", store.RoleUser)

	tests := []struct {
		name string
		body func(testing.TB) []byte
		want int
	}{
		{
			name: "text claiming to be an image",
			body: func(testing.TB) []byte { return []byte("this is not an image") },
			want: http.StatusUnprocessableEntity,
		},
		{
			name: "nothing at all",
			body: func(testing.TB) []byte { return []byte{} },
			want: http.StatusUnprocessableEntity,
		},
		{
			// Refused on the declared dimensions alone. Nothing decodes it: the
			// pixels this header promises are 1.6 GB of bitmap.
			name: "a header declaring 20000x20000",
			body: func(testing.TB) []byte { return testutil.PNGHeader(20000, 20000) },
			want: http.StatusUnprocessableEntity,
		},
		{
			name: "a real image that is too wide",
			body: func(t testing.TB) []byte {
				return testutil.SolidPNG(t, imaging.MaxDimension+1, 8, testutil.Opaque)
			},
			want: http.StatusUnprocessableEntity,
		},
		{
			// Noticed by the reader rather than by the decoder — the body is
			// never read to the end — and deliberately answered the same way,
			// so a form has one message about size instead of two that depend
			// on how far over the limit the file was.
			name: "more bytes than the cap",
			body: func(testing.TB) []byte { return make([]byte, imaging.MaxBytes*2) },
			want: http.StatusUnprocessableEntity,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := h.doRaw("POST", "/api/v1/me/avatar", token, "image/png", tt.body(t))
			if resp.StatusCode != tt.want {
				t.Errorf("upload %s = %d, want %d", tt.name, resp.StatusCode, tt.want)
			}
		})
	}

	t.Run("an unverified account cannot upload one", func(t *testing.T) {
		unverified := h.sign(h.unverifiedUser("picture.unverified@example.com", store.RoleUser))
		resp := h.doRaw("POST", "/api/v1/me/avatar", unverified, "image/png",
			testutil.SolidPNG(t, 16, 16, testutil.Opaque))
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("unverified upload = %d, want 403", resp.StatusCode)
		}
	})

	t.Run("a guest cannot upload one", func(t *testing.T) {
		resp := h.doRaw("POST", "/api/v1/me/avatar", "", "image/png",
			testutil.SolidPNG(t, 16, 16, testutil.Opaque))
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("guest upload = %d, want 401", resp.StatusCode)
		}
	})
}
