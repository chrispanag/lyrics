// Package store is the data access layer: hand-written pgx queries, since most
// of the surface (composable filters, blended ranking) is dynamic.
package store

import (
	"time"

	"github.com/google/uuid"
)

// Role is an authorization level. The zero value is deliberately not a valid
// role, so a forgotten assignment fails closed rather than granting access.
type Role string

// The roles, from least to most privileged.
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

// CreditRole is the capacity in which a person is credited on a song:
// authorship only. Performers live in RecordingPerformer.
type CreditRole string

// The credit roles the schema accepts.
const (
	CreditComposer CreditRole = "composer"
	CreditLyricist CreditRole = "lyricist"
)

// Valid reports whether the credit role is one the schema accepts.
func (c CreditRole) Valid() bool {
	switch c {
	case CreditComposer, CreditLyricist:
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
	// EmailVerifiedAt is null until the email:verify step-up completes.
	EmailVerifiedAt *time.Time `json:"email_verified_at"`
	// AvatarUpdatedAt is null until a picture is uploaded. It is the picture's
	// only version: it busts the stable URL's cache and decides the initials
	// fallback.
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

// RecordingPerformer links a person to a recording; there is no role. Name is
// filled on read and ignored on write.
type RecordingPerformer struct {
	PersonID uuid.UUID `json:"person_id"`
	Name     string    `json:"name"`
	Position int       `json:"position"`
}

// Recording is one performance of a song (an εκτέλεση). A song's recordings
// arrive first recording first; IsFirst may be false on all of them, so the
// order falls back to year, then Position. The rule lives in attachRelations
// and, mirrored, in refresh_songs_denorm.
type Recording struct {
	ID             uuid.UUID            `json:"id"`
	Label          *string              `json:"label"`
	YouTubeURL     *string              `json:"youtube_url"`
	YouTubeVideoID *string              `json:"youtube_video_id"`
	ReleaseYear    *int                 `json:"release_year"`
	Notes          *string              `json:"notes"`
	IsFirst        bool                 `json:"is_first"`
	Position       int                  `json:"position"`
	Performers     []RecordingPerformer `json:"performers"`
}

// Song is a catalog entry. Snippet and Score are populated only by search.
type Song struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
	// Slug is the song's address (/songs/<slug>), set by a BEFORE INSERT trigger
	// and never recomputed, so a retitle cannot move a URL. Nothing here writes
	// it.
	Slug     string  `json:"slug"`
	AltTitle *string `json:"alt_title"`
	// Lyrics is present only on single-song reads; listings omit it. A pointer
	// because "not loaded" and "no lyrics" differ.
	Lyrics   *string `json:"lyrics,omitempty"`
	Language string  `json:"language"`
	// YouTubeURL, YouTubeVideoID and ReleaseYear are trigger-maintained copies
	// of the first recording's. Nothing in this package may write them.
	YouTubeURL     *string     `json:"youtube_url"`
	YouTubeVideoID *string     `json:"youtube_video_id"`
	ReleaseYear    *int        `json:"release_year"`
	Notes          *string     `json:"notes"`
	Credits        []Credit    `json:"credits"`
	Genres         []Genre     `json:"genres"`
	Recordings     []Recording `json:"recordings"`
	CreatedBy      *uuid.UUID  `json:"created_by"`
	UpdatedBy      *uuid.UUID  `json:"updated_by"`
	CreatedAt      time.Time   `json:"created_at"`
	UpdatedAt      time.Time   `json:"updated_at"`

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

// PublicList is what anyone may enumerate about a public list: its address
// and when it last changed. Deliberately not the owner, the name or the songs.
type PublicList struct {
	ID        uuid.UUID `json:"id"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CreditedPerson is what anyone may enumerate about a person on at least one
// song: the id their catalog page is addressed by, and nothing else (no date:
// web/src/app/sitemap.ts says why).
type CreditedPerson struct {
	ID uuid.UUID `json:"id"`
}
