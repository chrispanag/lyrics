package prelude

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
)

// Fake is an in-memory Client for tests and offline development.
type Fake struct {
	mu sync.Mutex

	// Users maps a Prelude user ID to its email.
	Users map[string]string
	// Passwords records which users have a password set. A user present in
	// Users but absent here is the half-created state that registration's
	// compensation logic exists to prevent.
	Passwords map[string]string

	// FailSetPassword makes SetPassword fail, to exercise the rollback path.
	FailSetPassword error
	// FailCreateUser makes CreateUser fail.
	FailCreateUser error
	// FailDeleteUser makes the rollback itself fail.
	FailDeleteUser error

	// Calls records method names in order, so tests can assert that
	// compensation actually ran.
	Calls []string

	nextID int
}

// NewFake returns an empty fake.
func NewFake() *Fake {
	return &Fake{
		Users:     map[string]string{},
		Passwords: map[string]string{},
	}
}

func (f *Fake) record(name string) {
	f.Calls = append(f.Calls, name)
}

// CalledWith reports whether a method was invoked.
func (f *Fake) CalledWith(name string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Contains(f.Calls, name)
}

func (f *Fake) CreateUser(_ context.Context, email string, _ *Profile) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.record("CreateUser")

	if f.FailCreateUser != nil {
		return "", f.FailCreateUser
	}
	for _, existing := range f.Users {
		if strings.EqualFold(existing, email) {
			return "", fmt.Errorf("%w: %s", ErrDuplicateIdentifier, email)
		}
	}

	f.nextID++
	id := fmt.Sprintf("usr_fake_%d", f.nextID)
	f.Users[id] = email
	return id, nil
}

func (f *Fake) SetPassword(_ context.Context, userID, password string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.record("SetPassword")

	if f.FailSetPassword != nil {
		return f.FailSetPassword
	}
	if _, ok := f.Users[userID]; !ok {
		return fmt.Errorf("%w: no such user %s", ErrUpstream, userID)
	}
	f.Passwords[userID] = password
	return nil
}

func (f *Fake) DeleteUser(_ context.Context, userID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.record("DeleteUser")

	if f.FailDeleteUser != nil {
		return f.FailDeleteUser
	}
	delete(f.Users, userID)
	delete(f.Passwords, userID)
	return nil
}

// Orphans returns users that exist without a password — accounts that can
// neither sign in nor be registered again. This should always be empty after a
// failed registration, which is the property compensation guarantees.
func (f *Fake) Orphans() []string {
	f.mu.Lock()
	defer f.mu.Unlock()

	var orphans []string
	for id := range f.Users {
		if _, ok := f.Passwords[id]; !ok {
			orphans = append(orphans, id)
		}
	}
	return orphans
}
