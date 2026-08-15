package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/prelude"
	"github.com/christos/lyrics/backend/internal/store"
)

type registerRequest struct {
	Email       string  `json:"email"`
	Password    string  `json:"password"`
	DisplayName *string `json:"display_name"`
}

// handleRegister creates an account.
//
// Registration lives here rather than in the browser because the Prelude web
// SDK can only *log in* — creating a user is a Management API operation that
// requires the API key, which must never reach a browser. The client therefore
// calls this endpoint, then signs in against Prelude directly.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) error {
	if !s.registerLimiter.allow(clientIP(r)) {
		return httpx.RateLimited("Too many registration attempts. Please try again shortly.")
	}

	var req registerRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}

	email := normalizeEmail(req.Email)
	problems := validationErrors{}
	if !validEmail(email) {
		problems.add("email", "Enter a valid email address.")
	}
	if msg := validatePassword(req.Password); msg != "" {
		problems.add("password", msg)
	}
	displayName := trimmedPtr(req.DisplayName)
	if displayName != nil && utf8.RuneCountInString(*displayName) > maxNameLen {
		problems.add("display_name", "Display name is too long.")
	}
	if !problems.empty() {
		return httpx.Validation("Your account could not be created.").WithDetails(problems)
	}

	profile := profileFromDisplayName(displayName)

	preludeUserID, err := s.prelude.CreateUser(r.Context(), email, profile)
	if err != nil {
		switch {
		case errors.Is(err, prelude.ErrDuplicateIdentifier):
			return httpx.Conflict("An account with that email already exists.").WithCause(err)
		case errors.Is(err, prelude.ErrWeakPassword):
			return httpx.Validation("Your account could not be created.").
				WithDetails(validationErrors{"password": passwordRejectionMessage(err)}).WithCause(err)
		default:
			return httpx.Upstream("The authentication service is unavailable.").WithCause(err)
		}
	}

	// The user now exists in Prelude but has no password, so they can neither
	// sign in nor register again with the same email. If setting the password
	// fails, that account must be removed or the address is permanently burned.
	if err := s.prelude.SetPassword(r.Context(), preludeUserID, req.Password); err != nil {
		s.compensateFailedRegistration(preludeUserID, email)

		if errors.Is(err, prelude.ErrWeakPassword) {
			return httpx.Validation("Your account could not be created.").
				WithDetails(validationErrors{"password": passwordRejectionMessage(err)}).WithCause(err)
		}
		return httpx.Upstream("The authentication service is unavailable.").WithCause(err)
	}

	role := store.RoleUser
	if s.cfg.IsBootstrapAdmin(email) {
		role = store.RoleAdmin
	}

	user, err := s.store.CreateUserRecord(r.Context(), preludeUserID, email, displayName, role)
	if err != nil {
		// The Prelude account is complete and usable at this point, so it is
		// deliberately left in place: the next sign-in provisions the local row
		// just-in-time. Deleting a working account would be the worse outcome.
		slog.Error("created prelude user but failed to create local record",
			"prelude_user_id", preludeUserID, "error", err)
		return storeError(err, "Account")
	}

	httpx.JSON(w, http.StatusCreated, user)
	return nil
}

// compensateFailedRegistration removes a half-created Prelude account.
//
// It runs on a fresh background context: the request context may already be
// canceled (a client that hung up, a timeout), and inheriting that cancellation
// would skip the very cleanup this exists to perform.
func (s *Server) compensateFailedRegistration(preludeUserID, email string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := s.prelude.DeleteUser(ctx, preludeUserID); err != nil {
		// Nothing more can be done automatically, but this must be visible:
		// the address is now unusable for registration until an operator
		// removes the orphan.
		slog.Error("failed to roll back partially created prelude user; "+
			"this email cannot be registered again until the account is deleted manually",
			"prelude_user_id", preludeUserID, "email", email, "error", err)
		return
	}
	slog.Info("rolled back partially created prelude user", "prelude_user_id", preludeUserID)
}

// passwordRejectionMessage surfaces Prelude's own explanation, which is the
// authority on the configured composition rules.
func passwordRejectionMessage(err error) string {
	var pe *prelude.Error
	if errors.As(err, &pe) && pe.Detail != "" {
		return pe.Detail
	}
	return "Password does not meet the requirements."
}

// profileFromDisplayName splits a display name into the first/last fields the
// Prelude profile expects. A single-word name becomes the first name only.
func profileFromDisplayName(displayName *string) *prelude.Profile {
	if displayName == nil {
		return nil
	}
	first, last, found := strings.Cut(strings.TrimSpace(*displayName), " ")
	if !found {
		return &prelude.Profile{FirstName: first}
	}
	return &prelude.Profile{FirstName: first, LastName: strings.TrimSpace(last)}
}
