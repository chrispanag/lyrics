package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

type contextKey string

const principalKey contextKey = "principal"

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

// resolve verifies a token and returns the matching local user, provisioning
// one if this principal has never been seen here before.
func (a *Authenticator) resolve(ctx context.Context, raw string) (*store.User, error) {
	claims, err := a.verifier.Verify(ctx, raw)
	if err != nil {
		if errors.Is(err, ErrInvalidToken) {
			return nil, httpx.Unauthorized("Access token is invalid or has expired.").WithCause(err)
		}
		// Reaching the JWKS failed: the token may well be fine.
		return nil, httpx.Internal("Unable to verify credentials.").WithCause(err)
	}

	user, err := a.users.GetUserByPreludeID(ctx, claims.UserID)
	if err == nil {
		return user, nil
	}
	if !store.IsNotFound(err) {
		return nil, httpx.Internal("Unable to load your account.").WithCause(err)
	}

	// Just-in-time provisioning. This covers a user created directly in the
	// Prelude dashboard, and a local database restored from a backup older than
	// the account — both of which would otherwise present as a confusing 403.
	if claims.Email == "" {
		return nil, httpx.Internal("Account cannot be provisioned.").WithCause(
			errors.New("token has no email claim; configure an `email` custom claim " +
				"for this Prelude application (see README: Prelude setup)"))
	}

	role := store.RoleUser
	if a.isAdmin(claims.Email) {
		role = store.RoleAdmin
	}

	user, err = a.users.ProvisionUser(ctx, claims.UserID, claims.Email, role)
	if err != nil {
		return nil, httpx.Internal("Unable to provision your account.").WithCause(err)
	}

	slog.Info("provisioned user on first authenticated request",
		"user_id", user.ID, "role", user.Role)
	return user, nil
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

		user, err := a.resolve(r.Context(), raw)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, user)))
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
