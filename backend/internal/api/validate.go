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
	maxLabelLen       = 200
	maxLyricsLen      = 100_000
	maxNotesLen       = 5_000
	maxDescriptionLen = 1_000
	minPasswordLen    = 8
	maxPasswordLen    = 256

	// Collection bounds. The 1 MB body cap alone is not a bound on *work*: a
	// credit is about 30 bytes on the wire but costs one sequential round trip
	// to upsert a person, and a bare UUID is 38 bytes but costs one UPDATE in
	// an open transaction. Left uncapped, a single accepted request could hold
	// one of the ten pooled connections for the full write timeout.
	//
	// maxPerformers is counted across all of a song's recordings rather than per
	// recording, because it is the total number of person upserts that costs the
	// round trips — sixteen recordings each allowed sixty-four performers would
	// bound the wire and not the work at all. Worst case is now maxCredits +
	// maxPerformers sequential upserts in one request, twice what it was before
	// recordings existed; still bounded, still behind contributor auth.
	maxCredits     = 64
	maxPerformers  = 64
	maxRecordings  = 16
	maxGenreRefs   = 32
	maxReorderRefs = 2_000
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
	// Runes on both sides. Measuring the maximum in bytes rejected a 200-
	// character Greek passphrase at roughly 400 bytes, while telling the user
	// the limit was 256 characters.
	case utf8.RuneCountInString(password) > maxPasswordLen:
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
// Returns ("", false) when the input is not recognizably YouTube, which rejects
// tracking-laden and malformed links at the boundary. The extracted ID is stored
// alongside the URL because the ID is the part that has been validated: the UI
// builds its link out of it and never renders the stored URL as an href.
//
// The editor's live preview mirrors this function in TypeScript — extractVideoId
// in web/src/lib/youtube.ts — because the preview is the only
// confirmation a contributor gets that a pasted link was recognized. The two
// cannot be made to share one implementation, so a host or a path shape added
// here and not there reads as the field refusing a link this function would
// have saved, and one added there and not here as a preview the save then
// contradicts. Silent both ways round: change both.
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

	// Lowercase before trimming, not after: url.Parse preserves the host's case,
	// so trimming first leaves "WWW.YOUTUBE.COM" with its prefix intact and the
	// switch below rejects a perfectly ordinary pasted link.
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
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
