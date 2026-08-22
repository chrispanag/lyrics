package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

type contextKey string

const (
	principalKey contextKey = "principal"
	scopesKey    contextKey = "scopes"
)

// UserStore is the slice of the data layer the auth middleware needs. Narrowing
// it to two methods keeps the middleware testable without a database.
type UserStore interface {
	GetUserByPreludeID(ctx context.Context, preludeID string) (*store.User, error)
	ProvisionUser(ctx context.Context, preludeID, email string, role store.Role) (*store.User, error)
}

// Authenticator resolves bearer tokens into local users.
type Authenticator struct {
	verifier *Verifier
	users    UserStore
	isAdmin  func(email string) bool
}

// NewAuthenticator wires token verification to local user resolution.
// isBootstrapAdmin decides whether a newly provisioned email starts as admin.
func NewAuthenticator(v *Verifier, users UserStore, isBootstrapAdmin func(string) bool) *Authenticator {
	if isBootstrapAdmin == nil {
		isBootstrapAdmin = func(string) bool { return false }
	}
	return &Authenticator{verifier: v, users: users, isAdmin: isBootstrapAdmin}
}

// FromContext returns the authenticated user, or nil for a guest.
func FromContext(ctx context.Context) *store.User {
	user, _ := ctx.Value(principalKey).(*store.User)
	return user
}

// HasScope reports whether the token on this request carries a step-up grant.
//
// The grant is short-lived and specific to the challenge that produced it, so
// this answers "did the caller just prove something", not "who is the caller".
func HasScope(ctx context.Context, scope string) bool {
	scopes, _ := ctx.Value(scopesKey).([]string)
	return slices.Contains(scopes, scope)
}

// MustFromContext returns the authenticated user, panicking if absent. Only
// valid inside handlers mounted behind Authenticator.Required, where a missing
// principal is a routing bug rather than a runtime condition.
func MustFromContext(ctx context.Context) *store.User {
	user := FromContext(ctx)
	if user == nil {
		panic("auth: no principal in context; handler is not behind Authenticator.Required")
	}
	return user
}

// bearerToken extracts a token from the Authorization header.
func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if header == "" {
		return ""
	}
	scheme, token, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

// resolve verifies a token and returns the matching local user together with
// the token's claims, provisioning the user if this principal has never been
// seen here before.
func (a *Authenticator) resolve(ctx context.Context, raw string) (*store.User, *Claims, error) {
	claims, err := a.verifier.Verify(ctx, raw)
	if err != nil {
		if errors.Is(err, ErrInvalidToken) {
			return nil, nil, httpx.Unauthorized("Access token is invalid or has expired.").WithCause(err)
		}
		// Reaching the JWKS failed: the token may well be fine.
		return nil, nil, httpx.Internal("Unable to verify credentials.").WithCause(err)
	}

	user, err := a.users.GetUserByPreludeID(ctx, claims.UserID)
	if err == nil {
		return user, claims, nil
	}
	if !store.IsNotFound(err) {
		return nil, nil, httpx.Internal("Unable to load your account.").WithCause(err)
	}

	// Just-in-time provisioning. This covers a user created directly in the
	// Prelude dashboard, and a local database restored from a backup older than
	// the account — both of which would otherwise present as a confusing 403.
	if claims.Email == "" {
		return nil, nil, httpx.Internal("Account cannot be provisioned.").WithCause(
			errors.New("token has no email claim; configure an `email` custom claim " +
				"for this Prelude application (see README: Prelude setup)"))
	}

	role := store.RoleUser
	if a.isAdmin(claims.Email) {
		role = store.RoleAdmin
	}

	user, err = a.users.ProvisionUser(ctx, claims.UserID, claims.Email, role)
	if err != nil {
		// A local row already holds this address under a different Prelude
		// account, which is the one provisioning failure that is not a fault and
		// will not pass on the next request either. Reported as itself rather than
		// as a server error: "Unable to provision your account" sends whoever
		// reads it looking for an outage, and every sign-in by this account
		// answers the same way until the stale row is dealt with by hand.
		//
		// Logged here because answering 409 rather than 500 also moved the cause
		// out of sight: WriteError logs a 4xx cause at Debug and the default level
		// is Info, so the one path that tells a reader to contact support would
		// tell support nothing. Warn rather than Error — nothing here is failing,
		// and the answer above repeats — carrying the id and the address that
		// finding the stale row takes.
		if store.IsEmailTaken(err) {
			slog.Warn("local row holds this address under another prelude account",
				"prelude_user_id", claims.UserID, "email", claims.Email)
			return nil, nil, httpx.Conflict(
				"Your email address is registered to another account. Please contact support.").
				WithCause(err)
		}
		return nil, nil, httpx.Internal("Unable to provision your account.").WithCause(err)
	}

	slog.Info("provisioned user on first authenticated request",
		"user_id", user.ID, "role", user.Role)
	return user, claims, nil
}

// Optional attaches a principal when one is present.
//
// A request with no Authorization header proceeds as a guest, which is what
// makes the catalog browsable without an account. A request that *does* carry a
// token but fails verification is rejected with 401 rather than downgraded to
// guest: silently rendering signed-out content to someone holding an expired
// token looks like data loss, whereas a 401 tells the client to refresh and
// retry.
func (a *Authenticator) Optional(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := bearerToken(r)
		if raw == "" {
			next.ServeHTTP(w, r)
			return
		}

		user, claims, err := a.resolve(r.Context(), raw)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}

		ctx := context.WithValue(r.Context(), principalKey, user)
		// Scopes ride alongside the principal rather than on it: they belong to
		// the token this request arrived with, not to the account, and the next
		// request from the same user will usually carry none.
		ctx = context.WithValue(ctx, scopesKey, claims.Scopes)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// Required rejects unauthenticated requests. It must be mounted behind Optional,
// which does the actual token work.
func (a *Authenticator) Required(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if FromContext(r.Context()) == nil {
			httpx.WriteError(w, r, httpx.Unauthorized("Authentication is required for this action."))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireVerifiedEmail rejects a principal whose address has not been confirmed.
//
// It gates the authenticated groups as a whole rather than route by route, so
// the exemptions are the ones written out at the mount point — read your own
// profile, and finish verifying — and a route added later is gated by being
// added, not left open by omission.
//
// An account reaches this point with a perfectly valid session: verification is
// a property of the address, not of the credentials, so this is a 403 and never
// a 401. Answering 401 would send the client off to refresh a token that is
// already fine, and land it back here.
func RequireVerifiedEmail(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := FromContext(r.Context())
		if user == nil {
			httpx.WriteError(w, r, httpx.Unauthorized("Authentication is required for this action."))
			return
		}
		if !user.EmailVerified() {
			httpx.WriteError(w, r, httpx.Forbidden(
				"Confirm your email address before using your account."))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRole rejects principals below the given role.
func RequireRole(minimum store.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := FromContext(r.Context())
			if user == nil {
				httpx.WriteError(w, r, httpx.Unauthorized("Authentication is required for this action."))
				return
			}
			if !user.Role.AtLeast(minimum) {
				httpx.WriteError(w, r, httpx.Forbidden(
					"This action requires the %s role.", minimum))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CanEditSong reports whether a user may modify a song, given the account that
// created it — nil for catalog content entered without an author.
//
// Admins may edit anything. Contributors may edit only what they created: the
// role exists to let trusted users grow the catalog, not to let any one of them
// rewrite another's work.
//
// Taking the owner rather than the whole song keeps the caller free to fetch
// just that column, and keeps this decision independent of the song's shape.
func CanEditSong(user *store.User, createdBy *uuid.UUID) bool {
	if user == nil {
		return false
	}
	if user.Role == store.RoleAdmin {
		return true
	}
	if user.Role != store.RoleContributor {
		return false
	}
	return createdBy != nil && *createdBy == user.ID
}
