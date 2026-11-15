package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/prelude"
	"github.com/christos/lyrics/backend/internal/store"
)

type registerRequest struct {
	Email       string  `json:"email"`
	Password    string  `json:"password"`
	DisplayName *string `json:"display_name"`
}

// handleRegister creates an account. It lives server-side because creating a
// Prelude user needs the Management API key, which must never reach a browser.
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) error {
	if !s.registerLimiter.allow(clientIP(r, s.cfg.ClientIPHeader)) {
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
			return authUnavailable(err)
		}
	}

	// A Prelude user without a password can neither sign in nor re-register:
	// remove it on failure or the address is burned.
	if err := s.prelude.SetPassword(r.Context(), preludeUserID, req.Password); err != nil {
		s.compensateFailedRegistration(preludeUserID, email)

		if errors.Is(err, prelude.ErrWeakPassword) {
			return httpx.Validation("Your account could not be created.").
				WithDetails(validationErrors{"password": passwordRejectionMessage(err)}).WithCause(err)
		}
		return authUnavailable(err)
	}

	role := store.RoleUser
	if s.cfg.IsBootstrapAdmin(email) {
		role = store.RoleAdmin
	}

	user, err := s.store.CreateUserRecord(r.Context(), preludeUserID, email, displayName, role)
	if err != nil {
		// A local row holds this address under another Prelude id; JIT
		// provisioning would fail the same way forever, so roll back. Never
		// re-key the row. See CLAUDE.md "Decisions worth not reversing".
		if store.IsEmailTaken(err) {
			s.compensateFailedRegistration(preludeUserID, email)
			slog.Error("local row holds this address under another prelude account",
				"prelude_user_id", preludeUserID, "error", err)
			return httpx.Conflict("An account with that email already exists.").WithCause(err)
		}

		// Any other failure is likely transient; the Prelude account is usable
		// and the next sign-in provisions the local row just-in-time.
		slog.Error("created prelude user but failed to create local record",
			"prelude_user_id", preludeUserID, "error", err)
		return storeError(err, "Account")
	}

	httpx.JSON(w, http.StatusCreated, user)
	return nil
}

// compensateFailedRegistration removes a half-created Prelude account. It uses
// a fresh context so a canceled request cannot skip the cleanup.
func (s *Server) compensateFailedRegistration(preludeUserID, email string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := s.prelude.DeleteUser(ctx, preludeUserID); err != nil {
		slog.Error("failed to roll back partially created prelude user; "+
			"this email cannot be registered again until the account is deleted manually",
			"prelude_user_id", preludeUserID, "email", email, "error", err)
		return
	}
	slog.Info("rolled back partially created prelude user", "prelude_user_id", preludeUserID)
}

// EmailVerifyScope is the step-up scope that proves an address. Must match the
// Prelude config and EMAIL_VERIFY_SCOPE (TypeScript).
const EmailVerifyScope = "email:verify"

// handleVerifyEmail records an address proven by a completed step-up challenge.
// No body: the proof is the scope on the signed token.
func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) error {
	user := auth.MustFromContext(r.Context())

	// Idempotent, so a double submission or second tab does not report failure.
	if user.EmailVerified() {
		httpx.JSON(w, http.StatusOK, user)
		return nil
	}

	// 403, not 401: a 401 makes the client refresh a token that is fine.
	if !auth.HasScope(r.Context(), EmailVerifyScope) {
		return httpx.Forbidden("Confirm your email address before using your account.")
	}

	updated, err := s.store.MarkEmailVerified(r.Context(), user.ID)
	if err != nil {
		return storeError(err, "Account")
	}

	httpx.JSON(w, http.StatusOK, updated)
	return nil
}

// authUnavailable is the answer for a Prelude failure the caller cannot act on;
// the specific cause goes to the logs.
func authUnavailable(err error) *httpx.APIError {
	return httpx.Upstream("The authentication service is unavailable.").WithCause(err)
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
