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
			return authUnavailable(err)
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
		return authUnavailable(err)
	}

	role := store.RoleUser
	if s.cfg.IsBootstrapAdmin(email) {
		role = store.RoleAdmin
	}

	user, err := s.store.CreateUserRecord(r.Context(), preludeUserID, email, displayName, role)
	if err != nil {
		// A local row already holds this address under another Prelude account,
		// and no later request can get past it: provisioning just-in-time is what
		// the case below is waiting for, and it fails on the same constraint every
		// time. Leaving the account would stack a second unusable Prelude
		// identity on the address on every attempt, none of which can ever sign
		// in — so this one is removed, exactly as a failed SetPassword is.
		//
		// The address stays unusable until the stale row is dealt with by hand,
		// which is a support matter rather than something to guess at here: the
		// row cannot be re-keyed onto this new account without handing over
		// whatever it holds, and it cannot be deleted without discarding somebody
		// else's lists.
		if store.IsEmailTaken(err) {
			s.compensateFailedRegistration(preludeUserID, email)
			slog.Error("local row holds this address under another prelude account",
				"prelude_user_id", preludeUserID, "error", err)
			return httpx.Conflict("An account with that email already exists.").WithCause(err)
		}

		// Any other failure is transient — the database being unreachable, most
		// likely. The Prelude account is complete and usable, so it is
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

// EmailVerifyScope is the step-up scope that proves an address.
//
// Prelude runs the challenge — it emails the code and decides whether the one
// the user typed is right — and signs the granted scope into the access token
// when it completes. This endpoint's whole job is to read that grant and write
// it down, because Prelude keeps no verified flag of its own to read later.
const EmailVerifyScope = "email:verify"

// handleVerifyEmail records an address proven by a completed step-up challenge.
//
// There is no request body and no code: the code went to Prelude, never here.
// Trusting the caller is not what makes this safe — the grant is a claim inside
// a signature only Prelude can produce, checked on the way in like every other
// claim on the token.
func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) error {
	user := auth.MustFromContext(r.Context())

	// Answering an already-verified account with its profile rather than an
	// error keeps a double submission, or a second tab, from reporting a failure
	// for something that has already succeeded.
	if user.EmailVerified() {
		httpx.JSON(w, http.StatusOK, user)
		return nil
	}

	// 403 and never 401: the session is perfectly valid, it simply has not
	// proven the address. A 401 would send the client off to refresh a token
	// that is already fine, and land it back here having lost the grant.
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

// authUnavailable is the answer for a Prelude failure the caller cannot act on.
//
// Every path through registration and verification ends here when the upstream
// is unreachable or unwilling, and they say the same thing on purpose: which
// call failed is a detail the user cannot use, and it reaches the logs as the
// wrapped cause instead.
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
