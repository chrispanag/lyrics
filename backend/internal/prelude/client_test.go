package prelude

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *HTTPClient {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return New(server.URL, "app123", "secret-key")
}

func TestCreateUser(t *testing.T) {
	var gotPath, gotAuth, gotBody string

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "usr_01jq"})
	})

	id, err := client.CreateUser(context.Background(), "singer@example.com",
		&Profile{FirstName: "Nick", LastName: "Cave"})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if id != "usr_01jq" {
		t.Errorf("id = %q, want %q", id, "usr_01jq")
	}
	if want := "/v2/session/apps/app123/users"; gotPath != want {
		t.Errorf("path = %q, want %q", gotPath, want)
	}
	if want := "Bearer secret-key"; gotAuth != want {
		t.Errorf("Authorization = %q, want %q", gotAuth, want)
	}
	if !strings.Contains(gotBody, `"type":"email_address"`) {
		t.Errorf("body %q should declare an email_address identifier", gotBody)
	}
	if !strings.Contains(gotBody, `"first_name":"Nick"`) {
		t.Errorf("body %q should carry the profile", gotBody)
	}
}

// A create that returns 200 with no id would otherwise be reported as success,
// and registration would continue with an empty user identifier.
func TestCreateUserRejectsEmptyID(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{})
	})

	_, err := client.CreateUser(context.Background(), "a@example.com", nil)
	if !errors.Is(err, ErrUpstream) {
		t.Fatalf("error = %v, want ErrUpstream", err)
	}
}

// The duplicate-email case is the most common registration outcome and the only
// one a user can fix themselves, so it must be distinguishable from a generic
// upstream failure regardless of which status Prelude uses to report it.
func TestCreateUserClassifiesErrors(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"409 conflict", http.StatusConflict, `{"message":"identifier exists"}`, ErrDuplicateIdentifier},
		{"400 with duplicate wording", http.StatusBadRequest, `{"message":"Identifier already in use"}`, ErrDuplicateIdentifier},
		{"400 with taken wording", http.StatusBadRequest, `{"message":"email is taken"}`, ErrDuplicateIdentifier},
		{"400 password compliancy", http.StatusBadRequest, `{"message":"password does not meet compliancy rules"}`, ErrWeakPassword},
		{"400 unrecognized", http.StatusBadRequest, `{"message":"something else"}`, ErrUpstream},
		{"401 bad api key", http.StatusUnauthorized, `{"message":"unauthorized"}`, ErrUpstream},
		{"500 upstream", http.StatusInternalServerError, `{"message":"boom"}`, ErrUpstream},
		{"non-json body", http.StatusBadGateway, `<html>gateway</html>`, ErrUpstream},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = io.WriteString(w, tt.body)
			})

			_, err := client.CreateUser(context.Background(), "a@example.com", nil)
			if !errors.Is(err, tt.want) {
				t.Errorf("error = %v, want it to wrap %v", err, tt.want)
			}
		})
	}
}

func TestSetPassword(t *testing.T) {
	var gotMethod, gotPath, gotBody string

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})

	if err := client.SetPassword(context.Background(), "usr_01jq", "S3cret!pass"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	if gotMethod != http.MethodPut {
		t.Errorf("method = %q, want PUT", gotMethod)
	}
	if want := "/v2/session/apps/app123/users/usr_01jq/password"; gotPath != want {
		t.Errorf("path = %q, want %q", gotPath, want)
	}
	if !strings.Contains(gotBody, `"password":"S3cret!pass"`) {
		t.Errorf("body = %q, want the password field", gotBody)
	}
}

func TestDeleteUser(t *testing.T) {
	var gotMethod, gotPath string

	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	})

	if err := client.DeleteUser(context.Background(), "usr_01jq"); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	if gotMethod != http.MethodDelete {
		t.Errorf("method = %q, want DELETE", gotMethod)
	}
	if want := "/v2/session/apps/app123/users/usr_01jq"; gotPath != want {
		t.Errorf("path = %q, want %q", gotPath, want)
	}
}

// A user ID containing path separators must not be able to redirect the request
// to a different Management API resource.
func TestUserIDIsPathEscaped(t *testing.T) {
	var gotPath string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.EscapedPath()
		w.WriteHeader(http.StatusNoContent)
	})

	_ = client.DeleteUser(context.Background(), "../../config/login/password")

	if strings.Contains(gotPath, "/config/login/password") {
		t.Errorf("path %q escaped the users collection", gotPath)
	}
}

func TestNetworkFailureIsUpstream(t *testing.T) {
	// A server that is closed immediately refuses connections.
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := server.URL
	server.Close()

	client := New(url, "app123", "key")
	_, err := client.CreateUser(context.Background(), "a@example.com", nil)
	if !errors.Is(err, ErrUpstream) {
		t.Fatalf("error = %v, want ErrUpstream", err)
	}
}
