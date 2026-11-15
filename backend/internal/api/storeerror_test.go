package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

func TestStoreError(t *testing.T) {
	if err := storeError(nil, "Song"); err != nil {
		t.Errorf("storeError(nil) = %v, want nil", err)
	}

	tests := []struct {
		name   string
		err    error
		status int
		code   httpx.ErrorCode
	}{
		{"not found", store.ErrNotFound, http.StatusNotFound, httpx.CodeNotFound},
		{"conflict", store.ErrConflict, http.StatusConflict, httpx.CodeConflict},
		{"in use", store.ErrInUse, http.StatusConflict, httpx.CodeConflict},
		{"invalid", store.ErrInvalid, http.StatusUnprocessableEntity, httpx.CodeValidation},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Store errors arrive wrapped with context; mapping must see through it.
			cause := fmt.Errorf("get song: %w", tt.err)

			got := storeError(cause, "Song")
			var apiErr *httpx.APIError
			if !errors.As(got, &apiErr) {
				t.Fatalf("storeError returned %T, want *httpx.APIError", got)
			}
			if apiErr.Status != tt.status || apiErr.Code != tt.code {
				t.Errorf("got %d %s, want %d %s", apiErr.Status, apiErr.Code, tt.status, tt.code)
			}
			if !strings.Contains(apiErr.Message, "Song") {
				t.Errorf("message %q does not name the subject", apiErr.Message)
			}
			if !errors.Is(apiErr, tt.err) {
				t.Error("the original error is not kept as the cause, so it would not be logged")
			}
		})
	}

	// The driver's text could name tables or constraints, so it stays on the
	// cause and the client gets a fixed message.
	t.Run("anything else is a 500 that leaks nothing", func(t *testing.T) {
		driverErr := errors.New(`pq: relation "songs" does not exist`)

		var apiErr *httpx.APIError
		if !errors.As(storeError(driverErr, "Song"), &apiErr) {
			t.Fatal("storeError did not return an *httpx.APIError")
		}
		if apiErr.Status != http.StatusInternalServerError || apiErr.Message != "Unable to complete the request." {
			t.Errorf("got %d %q, want 500 with the generic message", apiErr.Status, apiErr.Message)
		}
		if !errors.Is(apiErr, driverErr) {
			t.Error("the driver error is not kept as the cause")
		}
	})

	// A handler that already chose its response must not have it replaced.
	t.Run("an APIError passes through untouched", func(t *testing.T) {
		chosen := httpx.Forbidden("Not yours.")
		if got := storeError(fmt.Errorf("wrapped: %w", chosen), "Song"); !errors.Is(got, chosen) {
			t.Errorf("storeError = %v, want the handler's own error", got)
		}
	})

	// An APIError unwraps to its cause, so one carrying a store error must not
	// be remapped by that cause. errors.Is cannot tell: the replacement would
	// wrap the original, so the status is what has to be asserted.
	t.Run("an APIError with a store cause keeps its own status", func(t *testing.T) {
		chosen := httpx.Forbidden("Not yours.").WithCause(store.ErrNotFound)

		var apiErr *httpx.APIError
		if !errors.As(storeError(chosen, "Song"), &apiErr) {
			t.Fatal("storeError did not return an *httpx.APIError")
		}
		if apiErr.Status != http.StatusForbidden || apiErr.Message != "Not yours." {
			t.Errorf("got %d %q, want the handler's 403", apiErr.Status, apiErr.Message)
		}
	})
}
