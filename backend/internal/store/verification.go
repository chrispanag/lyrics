package store

import (
	"context"

	"github.com/google/uuid"
)

// MarkEmailVerified records a confirmed address, returning the updated user.
//
// The timestamp is only written once: re-running verification on an account
// that is already verified must not move the date, which is the record of when
// the address was actually proven.
func (s *Store) MarkEmailVerified(ctx context.Context, userID uuid.UUID) (*User, error) {
	var user User
	if err := scanUser(s.pool.QueryRow(ctx, `
		UPDATE users SET email_verified_at = coalesce(email_verified_at, now())
		WHERE id = $1
		RETURNING `+userColumns, userID), &user); err != nil {
		return nil, translateErr(err)
	}
	return &user, nil
}
