package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const userColumns = `id, prelude_user_id, email, display_name, role, email_verified_at, created_at, updated_at`

func scanUser(row pgx.Row, u *User) error {
	return row.Scan(&u.ID, &u.PreludeUserID, &u.Email, &u.DisplayName, &u.Role,
		&u.EmailVerifiedAt, &u.CreatedAt, &u.UpdatedAt)
}

// GetUserByPreludeID looks up the local record for an authenticated principal.
func (s *Store) GetUserByPreludeID(ctx context.Context, preludeID string) (*User, error) {
	var u User
	query := "SELECT " + userColumns + " FROM users WHERE prelude_user_id = $1"
	if err := scanUser(s.pool.QueryRow(ctx, query, preludeID), &u); err != nil {
		return nil, translateErr(err)
	}
	return &u, nil
}

// GetUser loads a user by local ID.
func (s *Store) GetUser(ctx context.Context, id uuid.UUID) (*User, error) {
	var u User
	query := "SELECT " + userColumns + " FROM users WHERE id = $1"
	if err := scanUser(s.pool.QueryRow(ctx, query, id), &u); err != nil {
		return nil, translateErr(err)
	}
	return &u, nil
}

// ProvisionUser returns the local record for a Prelude principal, creating it if
// absent, along with that user's default list.
//
// This runs on every authenticated request whose principal is unknown, which
// happens both at registration and whenever an account exists in Prelude but not
// here — a user created directly in the Prelude dashboard, or a local database
// restored from an older backup. Provisioning on demand means those cases heal
// themselves instead of returning a confusing 403.
//
// The insert is idempotent: two concurrent first requests from the same new user
// would otherwise race, and one would fail on the unique constraint.
func (s *Store) ProvisionUser(ctx context.Context, preludeID, email string, role Role) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if role == "" {
		role = RoleUser
	}

	var user User
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		err := scanUser(tx.QueryRow(ctx, `
			INSERT INTO users (prelude_user_id, email, role)
			VALUES ($1, $2, $3)
			ON CONFLICT (prelude_user_id) DO UPDATE
			  SET email = EXCLUDED.email
			RETURNING `+userColumns, preludeID, email, role), &user)
		if err != nil {
			return fmt.Errorf("provision user: %w", translateErr(err))
		}

		// Every user gets one list up front, so "save this song" works without a
		// create-a-list detour the first time.
		_, err = tx.Exec(ctx, `
			INSERT INTO lists (owner_id, name, is_default)
			VALUES ($1, 'Favorites', true)
			ON CONFLICT DO NOTHING`, user.ID)
		if err != nil {
			return fmt.Errorf("create default list: %w", translateErr(err))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// CreateUserRecord inserts the local half of a newly registered account.
func (s *Store) CreateUserRecord(ctx context.Context, preludeID, email string, displayName *string, role Role) (*User, error) {
	user, err := s.ProvisionUser(ctx, preludeID, email, role)
	if err != nil {
		return nil, err
	}
	if displayName != nil && strings.TrimSpace(*displayName) != "" {
		return s.UpdateProfile(ctx, user.ID, displayName)
	}
	return user, nil
}

// UpdateProfile changes a user's own editable fields.
func (s *Store) UpdateProfile(ctx context.Context, id uuid.UUID, displayName *string) (*User, error) {
	var u User
	err := scanUser(s.pool.QueryRow(ctx, `
		UPDATE users SET display_name = $2 WHERE id = $1
		RETURNING `+userColumns, id, displayName), &u)
	if err != nil {
		return nil, translateErr(err)
	}
	return &u, nil
}

// SetRole changes a user's authorization level.
func (s *Store) SetRole(ctx context.Context, id uuid.UUID, role Role) (*User, error) {
	if !role.Valid() {
		return nil, fmt.Errorf("%w: invalid role %q", ErrInvalid, role)
	}
	var u User
	err := scanUser(s.pool.QueryRow(ctx, `
		UPDATE users SET role = $2 WHERE id = $1
		RETURNING `+userColumns, id, role), &u)
	if err != nil {
		return nil, translateErr(err)
	}
	return &u, nil
}

// CountAdmins reports how many admins exist. Used to refuse the demotion or
// deletion that would leave the platform with nobody able to administer it.
func (s *Store) CountAdmins(ctx context.Context) (int, error) {
	return s.count(ctx, "count admins", `SELECT count(*) FROM users WHERE role = 'admin'`)
}

// UserFilter narrows an admin user listing.
type UserFilter struct {
	Query  string
	Role   Role
	Limit  int
	Offset int
}

// ListUsers returns a page of users for the admin console.
func (s *Store) ListUsers(ctx context.Context, f UserFilter) ([]User, int, error) {
	f.Limit = clampLimit(f.Limit)

	a := &args{}
	conds := []string{"TRUE"}
	if q := strings.TrimSpace(f.Query); q != "" {
		// Escaped before the surrounding wildcards are added, so a literal `%`
		// or `_` typed into the admin search filters instead of matching
		// everything.
		p := a.next("%" + escapeLike(strings.ToLower(q)) + "%")
		conds = append(conds, fmt.Sprintf(
			"(email LIKE %[1]s ESCAPE '%[2]s' OR lower(coalesce(display_name, '')) LIKE %[1]s ESCAPE '%[2]s')",
			p, likeEscape))
	}
	if f.Role != "" {
		conds = append(conds, "role = "+a.next(string(f.Role)))
	}
	where := strings.Join(conds, " AND ")

	// Counted first so both statements can share `a` — the limit and offset
	// placeholders below append to a.values.
	total, err := s.count(ctx, "count users", "SELECT count(*) FROM users WHERE "+where, a.values...)
	if err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(
		"SELECT %s FROM users WHERE %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
		userColumns, where, a.next(f.Limit), a.next(f.Offset))

	users, err := queryAll(ctx, s, "users", query, scanUser, a.values...)
	return users, total, err
}

// DeleteUser removes the local record. Lists cascade; authored songs survive
// with a null created_by, because deleting an account must not delete catalog
// content other people rely on.
func (s *Store) DeleteUser(ctx context.Context, id uuid.UUID) error {
	return s.execExpectingRow(ctx, "delete user", `DELETE FROM users WHERE id = $1`, id)
}

// IsNotFound reports whether an error is (or wraps) ErrNotFound.
func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }

// IsConflict reports whether an error is (or wraps) ErrConflict.
func IsConflict(err error) bool { return errors.Is(err, ErrConflict) }

// IsInUse reports whether an error is (or wraps) ErrInUse.
func IsInUse(err error) bool { return errors.Is(err, ErrInUse) }

// IsInvalid reports whether an error is (or wraps) ErrInvalid.
func IsInvalid(err error) bool { return errors.Is(err, ErrInvalid) }
