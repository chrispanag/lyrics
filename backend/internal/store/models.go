// Package store is the data access layer. Queries are hand-written against pgx
// rather than generated: most of the surface here is dynamic (composable
// filters, a blended relevance ranking) which code generators model poorly.
package store

import (
	"time"

	"github.com/google/uuid"
)

// Role is an authorization level. The zero value is deliberately not a valid
// role, so a forgotten assignment fails closed rather than granting access.
type Role string

const (
	RoleUser        Role = "user"
	RoleContributor Role = "contributor"
	RoleAdmin       Role = "admin"
)

// rank orders roles for comparison. Unknown roles rank below everything.
func (r Role) rank() int {
	switch r {
	case RoleUser:
		return 1
	case RoleContributor:
		return 2
	case RoleAdmin:
		return 3
	default:
		return 0
	}
}

// AtLeast reports whether this role includes the privileges of the given one.
func (r Role) AtLeast(other Role) bool { return r.rank() >= other.rank() && r.rank() > 0 }

// Valid reports whether the role is one the schema accepts.
func (r Role) Valid() bool { return r.rank() > 0 }

// CreditRole is the capacity in which a person is credited on a song.
type CreditRole string

const (
	CreditArtist    CreditRole = "artist"
	CreditComposer  CreditRole = "composer"
	CreditLyricist  CreditRole = "lyricist"
	CreditPerformer CreditRole = "performer"
)

// Valid reports whether the credit role is one the schema accepts.
func (c CreditRole) Valid() bool {
	switch c {
	case CreditArtist, CreditComposer, CreditLyricist, CreditPerformer:
		return true
	default:
		return false
	}
}

// User mirrors a Prelude Auth account plus the authorization we own.
type User struct {
	ID            uuid.UUID `json:"id"`
	PreludeUserID string    `json:"-"`
	Email         string    `json:"email"`
	DisplayName   *string   `json:"display_name"`
	Role          Role      `json:"role"`
	// EmailVerifiedAt is null until the address is confirmed by completing the
	// email:verify step-up challenge. Serialized as the timestamp rather than a
	// derived boolean, so the client reads one field instead of two that could
	// disagree.
	EmailVerifiedAt *time.Time `json:"email_verified_at"`
	// AvatarUpdatedAt is null until a profile picture is uploaded. It is the
	// only version of the picture the client is given: the avatar's URL is
	// stable, so this is what busts its cache when a new one is written, and
	// what the fallback to initials is decided from.
	AvatarUpdatedAt *time.Time `json:"avatar_updated_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// EmailVerified reports whether the address has been confirmed.
func (u User) EmailVerified() bool { return u.EmailVerifiedAt != nil }

// Avatar is a stored profile picture. The bytes are never part of a User: they
// are read by one endpoint that serves them as an image and by nothing else.
type Avatar struct {
	ContentType string
	Image       []byte
	UpdatedAt   time.Time
}

// Person is anyone credited on a song.
type Person struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	SongCount int       `json:"song_count,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Genre is a musical category.
type Genre struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	SongCount int       `json:"song_count,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Credit links a person to a song in a specific capacity.
type Credit struct {
	PersonID uuid.UUID  `json:"person_id"`
	Name     string     `json:"name"`
	Role     CreditRole `json:"role"`
	Position int        `json:"position"`
}

// Song is a catalog entry. Snippet and Score are populated only by search.
type Song struct {
	ID       uuid.UUID `json:"id"`
	Title    string    `json:"title"`
	AltTitle *string   `json:"alt_title"`
	// Lyrics is the song body, present only on single-song reads. Listings —
	// browse, search and a list's songs — project it away: no screen showing
	// more than one song renders the body, and a page of twenty carried more
	// text than everything else in the response combined. Absent and empty are
	// therefore different answers, which is why this is a pointer: a song may
	// genuinely have no lyrics recorded, and that must not read as "not loaded".
	Lyrics         *string    `json:"lyrics,omitempty"`
	Language       string     `json:"language"`
	YouTubeURL     *string    `json:"youtube_url"`
	YouTubeVideoID *string    `json:"youtube_video_id"`
	ReleaseYear    *int       `json:"release_year"`
	Notes          *string    `json:"notes"`
	Credits        []Credit   `json:"credits"`
	Genres         []Genre    `json:"genres"`
	CreatedBy      *uuid.UUID `json:"created_by"`
	UpdatedBy      *uuid.UUID `json:"updated_by"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`

	// Snippet is a highlighted lyrics excerpt, present only on search results.
	Snippet *string `json:"snippet,omitempty"`
	// Score is the blended relevance score, present only on search results.
	Score *float64 `json:"score,omitempty"`
}

// List is a user-curated collection of songs.
type List struct {
	ID          uuid.UUID `json:"id"`
	OwnerID     uuid.UUID `json:"owner_id"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	IsPublic    bool      `json:"is_public"`
	IsDefault   bool      `json:"is_default"`
	ItemCount   int       `json:"item_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`

	// Songs is populated only when a single list is fetched with its contents.
	Songs []Song `json:"songs,omitempty"`
}
