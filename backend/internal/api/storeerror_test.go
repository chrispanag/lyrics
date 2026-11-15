package api

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

func TestStoreError(t *testing.T) {
	if err := storeError(nil, "Song"); err != nil {
		t.Errorf("storeError(nil) = %v, want nil", err)
	}

	tests := []struct {
		name    string
		err     error
		status  int
		code    httpx.ErrorCode
		message string
	}{
		{"not found", store.ErrNotFound, http.StatusNotFound, httpx.CodeNotFound, "Song was not found."},
		{"conflict", store.ErrConflict, http.StatusConflict, httpx.CodeConflict, "Song already exists."},
		{"in use", store.ErrInUse, http.StatusConflict, httpx.CodeConflict, "Song is still referenced by other records."},
		{"invalid", store.ErrInvalid, http.StatusUnprocessableEntity, httpx.CodeValidation, "Song is not valid."},
		// The driver's text could name tables or constraints; it stays on the cause.
		{
			"anything else", errors.New(`pq: relation "songs" does not exist`),
			http.StatusInternalServerError, httpx.CodeInternal, "Unable to complete the request.",
		},
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
			if apiErr.Status != tt.status || apiErr.Code != tt.code || apiErr.Message != tt.message {
				t.Errorf("got %d %s %q, want %d %s %q",
					apiErr.Status, apiErr.Code, apiErr.Message, tt.status, tt.code, tt.message)
			}
			if !errors.Is(apiErr, tt.err) {
				t.Error("the original error is not kept as the cause, so it would not be logged")
			}
		})
	}

	// A handler that already chose its response must not have it replaced.
	t.Run("an APIError passes through untouched", func(t *testing.T) {
		chosen := httpx.Forbidden("Not yours.")
		if got := storeError(fmt.Errorf("wrapped: %w", chosen), "Song"); !errors.Is(got, chosen) {
			t.Errorf("storeError = %v, want the handler's own error", got)
		}
	})
}
