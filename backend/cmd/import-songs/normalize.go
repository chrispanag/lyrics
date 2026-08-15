package main

import (
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/christos/lyrics/backend/internal/store"
)

// record is one line of the NDJSON interchange format. It is deliberately
// decoupled from the source schema: the exporter's job is to produce this
// shape, and everything downstream validates against the target schema alone.
// That split is what lets the loader be tested without touching the source.
type record struct {
	// SourceID is the old catalog's primary key. Never written to the target —
	// it exists so a rejected row can be traced back to its origin.
	SourceID    string   `json:"source_id,omitempty"`
	Title       string   `json:"title"`
	AltTitle    *string  `json:"alt_title,omitempty"`
	Lyrics      string   `json:"lyrics,omitempty"`
	Language    string   `json:"language,omitempty"`
	YouTubeURL  *string  `json:"youtube_url,omitempty"`
	ReleaseYear *int     `json:"release_year,omitempty"`
	Notes       *string  `json:"notes,omitempty"`
	Credits     []credit `json:"credits,omitempty"`
	Genres      []string `json:"genres,omitempty"`
}

type credit struct {
	Name string `json:"name"`
	Role string `json:"role"`
	// Position orders people within one role. When absent, slice order wins,
	// which is how the exporter preserves the source's own ordering.
	Position *int `json:"position,omitempty"`
}

// song is a record that has passed every check the target schema imposes.
// Producing one is the only way to reach the insert path, so a CHECK violation
// at COMMIT would mean a bug here rather than bad input.
type song struct {
	sourceID       string
	title          string
	altTitle       *string
	lyrics         string
	language       string
	youTubeURL     *string
	youTubeVideoID *string
	releaseYear    *int
	notes          *string
	credits        []resolvedCredit
	genres         []string
}

type resolvedCredit struct {
	name     string
	role     store.CreditRole
	position int
}

// defaultLanguage matches the songs.language column default. The catalog is
// Greek-first, so an unlabeled song is far likelier to be Greek than anything
// else — and the source schema has no language column at all.
const defaultLanguage = "el"

// languageAliases maps the spellings a hand-maintained catalog accumulates onto
// the two-letter codes the `language ~ '^[a-z]{2}$'` CHECK accepts. "gr" is the
// common wrong answer for Greek — the ISO 639-1 code is "el".
var languageAliases = map[string]string{
	"gr": "el", "gre": "el", "ell": "el", "greek": "el",
	"ελληνικα": "el", "ελληνικά": "el",
	"eng": "en", "english": "en", "αγγλικα": "en", "αγγλικά": "en",
}

var twoLetter = regexp.MustCompile(`^[a-z]{2}$`)

// normalizeLanguage resolves a source language label to a two-letter code,
// reporting whether it mapped cleanly or had to fall back to the default.
func normalizeLanguage(raw string) (code string, exact bool) {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return defaultLanguage, true // absent is not the same as unrecognized
	}
	if mapped, ok := languageAliases[s]; ok {
		return mapped, true
	}
	// Narrow a BCP-47 tag to its primary subtag: "en-US" and "el_GR" both carry
	// a usable code in front of the separator.
	if i := strings.IndexAny(s, "-_"); i > 0 {
		s = s[:i]
	}
	if twoLetter.MatchString(s) {
		return s, true
	}
	return defaultLanguage, false
}

// rawRoleAliases maps source vocabulary onto the four roles song_credits
// accepts. "songwriter" is the old catalog's own enum value and means the
// person who wrote the words, which is this schema's "lyricist". The Greek
// terms are here because the catalog is Greek-first.
//
// Keys are written readably and folded through foldKey at init, so lookups
// tolerate the same casing and accent variation the rest of the schema does.
var rawRoleAliases = map[string]store.CreditRole{
	"artist":     store.CreditArtist,
	"performer":  store.CreditPerformer,
	"singer":     store.CreditPerformer,
	"vocals":     store.CreditPerformer,
	"ερμηνευτής": store.CreditPerformer,
	"ερμηνεία":   store.CreditPerformer,
	"composer":   store.CreditComposer,
	"music":      store.CreditComposer,
	"μουσική":    store.CreditComposer,
	"συνθέτης":   store.CreditComposer,
	"songwriter": store.CreditLyricist,
	"lyricist":   store.CreditLyricist,
	"lyrics":     store.CreditLyricist,
	"writer":     store.CreditLyricist,
	"στίχοι":     store.CreditLyricist,
	"στιχουργός": store.CreditLyricist,
}

// roleAliases is rawRoleAliases with folded keys, built once at startup.
var roleAliases = func() map[string]store.CreditRole {
	m := make(map[string]store.CreditRole, len(rawRoleAliases))
	for k, v := range rawRoleAliases {
		m[foldKey(k)] = v
	}
	return m
}()

// fallbackRole is used when a source role has no mapping. Dropping the credit
// would silently strip attribution, which is worse than filing someone under
// the most generic of the four roles — and every fallback is reported.
const fallbackRole = store.CreditArtist

// normalizeRole resolves a source role label, reporting whether it was
// recognized.
func normalizeRole(raw string) (store.CreditRole, bool) {
	if strings.TrimSpace(raw) == "" {
		return fallbackRole, false
	}
	if r, ok := roleAliases[foldKey(raw)]; ok {
		return r, true
	}
	if r := store.CreditRole(strings.ToLower(strings.TrimSpace(raw))); r.Valid() {
		return r, true
	}
	return fallbackRole, false
}

// releaseYearBounds mirror the `release_year BETWEEN 1000 AND 2200` CHECK. A
// source value outside them (a 0 standing in for "unknown", say) is dropped to
// NULL rather than failing the whole import.
const (
	minReleaseYear = 1000
	maxReleaseYear = 2200
)

// youTubeIDPattern matches the 11-character video identifier.
var youTubeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// youTubeVideoID pulls the video identifier out of any URL shape YouTube hands
// out. Returns "" when the URL is not a recognizable YouTube link, leaving the
// column NULL rather than storing a wrong id.
func youTubeVideoID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// A bare id is a legitimate value in a hand-maintained catalog.
	if youTubeIDPattern.MatchString(raw) {
		return raw
	}

	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	host := strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")

	var candidate string
	switch {
	case host == "youtu.be":
		candidate = strings.TrimPrefix(u.Path, "/")
	case strings.HasSuffix(host, "youtube.com"), strings.HasSuffix(host, "youtube-nocookie.com"):
		if v := u.Query().Get("v"); v != "" {
			candidate = v
		} else {
			// /embed/<id>, /v/<id>, /shorts/<id> and /live/<id> all carry the
			// id as the final path segment.
			parts := strings.Split(strings.Trim(u.Path, "/"), "/")
			if len(parts) >= 2 {
				switch parts[0] {
				case "embed", "v", "shorts", "live":
					candidate = parts[1]
				}
			}
		}
	default:
		return ""
	}

	if youTubeIDPattern.MatchString(candidate) {
		return candidate
	}
	return ""
}

// foldKey produces the comparison key for names, roles and titles. It reuses
// Slugify — which lowercases, strips diacritics and transliterates Greek —
// because that collapses exactly the variation app_norm collapses in the
// database, so an in-process cache and the DB's uniqueness agree.
//
// Slugify returns "" for a string with no usable characters; those fall back to
// the trimmed lowercase form so distinct values never collide on "".
func foldKey(s string) string {
	if k := store.Slugify(s); k != "" {
		return k
	}
	return strings.ToLower(strings.TrimSpace(s))
}

// slugFor derives a genre's slug. cleanGenres has already rejected names that
// yield "", so every name reaching the writer has a usable slug.
func slugFor(name string) string { return store.Slugify(name) }

// normalizeText canonicalizes line endings and trims. Lyrics carried over from
// a catalog edited in a browser can hold CRLF, which would otherwise be stored
// verbatim and show up as stray blank lines in the reader.
func normalizeText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.TrimSpace(s)
}

// clean validates and normalizes one source record against the target schema,
// recording every non-fatal adjustment. A nil *song means the record cannot be
// stored at all.
func (r record) clean(w *warnings) (*song, error) {
	title := normalizeText(r.Title)
	if title == "" {
		return nil, fmt.Errorf("title is empty")
	}

	s := &song{
		sourceID: strings.TrimSpace(r.SourceID),
		title:    title,
		altTitle: optionalText(r.AltTitle),
		lyrics:   normalizeText(r.Lyrics),
		notes:    optionalText(r.Notes),
	}

	// An alt title that merely repeats the title carries no information, and
	// would be indexed a second time at weight B.
	if s.altTitle != nil && foldKey(*s.altTitle) == foldKey(title) {
		s.altTitle = nil
	}

	lang, exact := normalizeLanguage(r.Language)
	if !exact {
		w.add("language %q not recognized, stored as %q", strings.TrimSpace(r.Language), lang)
	}
	s.language = lang

	if raw := strings.TrimSpace(derefOr(r.YouTubeURL)); raw != "" {
		s.youTubeURL = &raw
		if id := youTubeVideoID(raw); id != "" {
			s.youTubeVideoID = &id
		} else {
			w.add("youtube_url %q yields no video id", raw)
		}
	}

	if r.ReleaseYear != nil {
		if y := *r.ReleaseYear; y >= minReleaseYear && y <= maxReleaseYear {
			s.releaseYear = &y
		} else {
			w.add("release_year %d outside %d-%d, stored as NULL", y, minReleaseYear, maxReleaseYear)
		}
	}

	s.credits = cleanCredits(r.Credits, w)
	s.genres = cleanGenres(r.Genres, w)
	return s, nil
}

// cleanCredits normalizes roles, drops blank names, and de-duplicates on
// (person, role) — the primary key of song_credits, which a source listing the
// same artist twice in one capacity would otherwise violate mid-transaction.
func cleanCredits(in []credit, w *warnings) []resolvedCredit {
	seen := make(map[string]bool, len(in))
	perRole := make(map[store.CreditRole]int, 4)
	out := make([]resolvedCredit, 0, len(in))

	for _, c := range in {
		name := normalizeText(c.Name)
		if name == "" {
			continue // a blank name would fail the people CHECK
		}
		role, known := normalizeRole(c.Role)
		if !known {
			w.add("credit role %q not recognized, stored as %q", strings.TrimSpace(c.Role), role)
		}

		key := foldKey(name) + "\x00" + string(role)
		if seen[key] {
			continue
		}
		seen[key] = true

		pos := perRole[role]
		if c.Position != nil && *c.Position >= 0 {
			pos = *c.Position
		}
		perRole[role]++

		out = append(out, resolvedCredit{name: name, role: role, position: pos})
	}
	return out
}

// cleanGenres drops blanks, de-duplicates by slug, and rejects names that yield
// no usable slug — genres.slug is NOT NULL under a strict format CHECK, so such
// a name cannot be stored at all.
func cleanGenres(in []string, w *warnings) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))

	for _, raw := range in {
		name := normalizeText(raw)
		if name == "" {
			continue
		}
		slug := store.Slugify(name)
		if slug == "" {
			w.add("genre %q yields no usable slug, association dropped", name)
			continue
		}
		if seen[slug] {
			continue
		}
		seen[slug] = true
		out = append(out, name)
	}
	return out
}

// fingerprint identifies a song for the purpose of recognizing one that is
// already imported: its normalized title plus the normalized set of everyone
// credited on it, order-independent.
//
// Title alone is too weak — this catalog has seven groups of distinct songs
// sharing a title — and the credit set is exactly what tells them apart.
func fingerprint(title string, creditNames []string) string {
	folded := make([]string, 0, len(creditNames))
	seen := make(map[string]bool, len(creditNames))
	for _, n := range creditNames {
		k := foldKey(n)
		if k != "" && !seen[k] {
			seen[k] = true
			folded = append(folded, k)
		}
	}
	sort.Strings(folded)
	return foldKey(title) + "\x1f" + strings.Join(folded, "|")
}

// fingerprint for an already-cleaned song.
func (s *song) fingerprint() string {
	names := make([]string, len(s.credits))
	for i, c := range s.credits {
		names[i] = c.name
	}
	return fingerprint(s.title, names)
}

// optionalText trims an optional string, collapsing blank to nil. The source
// stores 189 alt titles as empty strings rather than NULL; storing those
// verbatim would put an empty string where the schema means "absent".
func optionalText(p *string) *string {
	s := normalizeText(derefOr(p))
	if s == "" {
		return nil
	}
	return &s
}

func derefOr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
