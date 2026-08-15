package api

import (
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Field limits. These exist to bound storage and reject obvious junk, not to
// enforce editorial policy.
const (
	maxTitleLen       = 300
	maxNameLen        = 200
	maxLyricsLen      = 100_000
	maxNotesLen       = 5_000
	maxDescriptionLen = 1_000
	minPasswordLen    = 8
	maxPasswordLen    = 256
)

// validationErrors accumulates field-level problems so a form can show all of
// them at once instead of one per round trip.
type validationErrors map[string]string

func (v validationErrors) add(field, message string) { v[field] = message }
func (v validationErrors) empty() bool               { return len(v) == 0 }

// normalizeEmail lowercases and trims an address for storage and comparison.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// validEmail reports whether an address is plausibly deliverable. This is a
// syntax check only — the authority on whether an address can receive mail is
// the mail server, not a regex.
func validEmail(email string) bool {
	email = strings.TrimSpace(email)
	if email == "" || len(email) > 320 || strings.ContainsAny(email, " \t\r\n") {
		return false
	}
	addr, err := mail.ParseAddress(email)
	return err == nil && addr.Address == email
}

// validatePassword applies only the bounds we can enforce meaningfully here.
//
// Composition rules (uppercase, symbols, and so on) are configured per
// application in Prelude and are deliberately *not* duplicated: a second copy
// would drift from the real policy and start rejecting passwords Prelude would
// accept, or vice versa. Prelude is the authority, and its rejection is
// surfaced to the user verbatim.
func validatePassword(password string) string {
	switch {
	case utf8.RuneCountInString(password) < minPasswordLen:
		return "Password must be at least 8 characters."
	case len(password) > maxPasswordLen:
		return "Password is too long."
	default:
		return ""
	}
}

// youTubeIDPattern matches the 11-character video identifier.
var youTubeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// parseYouTubeURL extracts a video ID from the URL shapes users actually paste:
// a full watch link, a youtu.be short link, an embed link, or a bare ID.
//
// Returns ("", false) when the input is not recognizably YouTube. Storing the
// extracted ID alongside the URL lets the frontend build an embed without
// re-parsing, and rejects tracking-laden or malformed links at the boundary.
func parseYouTubeURL(raw string) (videoID string, ok bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	if youTubeIDPattern.MatchString(raw) {
		return raw, true
	}

	// A scheme-less "youtu.be/xyz" parses as a path, not a host.
	if !strings.Contains(raw, "//") {
		raw = "https://" + raw
	}

	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}

	host := strings.ToLower(strings.TrimPrefix(u.Hostname(), "www."))
	switch host {
	case "youtu.be":
		id := strings.Trim(u.Path, "/")
		if youTubeIDPattern.MatchString(id) {
			return id, true
		}
	case "youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com":
		if id := u.Query().Get("v"); youTubeIDPattern.MatchString(id) {
			return id, true
		}
		// /embed/<id>, /v/<id>, /shorts/<id>
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) == 2 {
			switch parts[0] {
			case "embed", "v", "shorts", "live":
				if youTubeIDPattern.MatchString(parts[1]) {
					return parts[1], true
				}
			}
		}
	}
	return "", false
}

// languagePattern matches an ISO 639-1 code, matching the schema's CHECK.
var languagePattern = regexp.MustCompile(`^[a-z]{2}$`)

// trimmedPtr normalizes an optional string: absent, or present and non-blank.
// A field the client sent as "   " is stored as NULL rather than whitespace.
func trimmedPtr(s *string) *string {
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
