package main

import (
	"errors"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/christos/lyrics/backend/internal/store"
)

// record is one line of the NDJSON interchange format, decoupled from the
// source schema so the loader validates against the target schema alone.
type record struct {
	// SourceID is the old catalog's primary key, kept only to trace rejected
	// rows; never written to the target.
	SourceID string  `json:"source_id,omitempty"`
	Title    string  `json:"title"`
	AltTitle *string `json:"alt_title,omitempty"`
	Lyrics   string  `json:"lyrics,omitempty"`
	Language string  `json:"language,omitempty"`
	// YouTubeURL and ReleaseYear describe a performance; they are folded into a
	// synthesized first recording when no explicit Recordings are given.
	YouTubeURL  *string  `json:"youtube_url,omitempty"`
	ReleaseYear *int     `json:"release_year,omitempty"`
	Notes       *string  `json:"notes,omitempty"`
	Credits     []credit `json:"credits,omitempty"`
	Genres      []string `json:"genres,omitempty"`
	// Recordings, when present, replaces the synthesis; the record-level
	// YouTubeURL and ReleaseYear are then expected to be absent.
	Recordings []recordingRecord `json:"recordings,omitempty"`
}

type credit struct {
	Name string `json:"name"`
	Role string `json:"role"`
	// Position orders people within one role; when absent, slice order wins.
	Position *int `json:"position,omitempty"`
}

type recordingRecord struct {
	Label       *string     `json:"label,omitempty"`
	YouTubeURL  *string     `json:"youtube_url,omitempty"`
	ReleaseYear *int        `json:"release_year,omitempty"`
	Notes       *string     `json:"notes,omitempty"`
	IsFirst     *bool       `json:"is_first,omitempty"`
	Performers  []performer `json:"performers,omitempty"`
}

type performer struct {
	Name     string `json:"name"`
	Position *int   `json:"position,omitempty"`
}

// song is a record that has passed every check the target schema imposes, so a
// CHECK violation at COMMIT means a bug here rather than bad input.
type song struct {
	sourceID   string
	title      string
	altTitle   *string
	lyrics     string
	language   string
	notes      *string
	credits    []resolvedCredit
	genres     []string
	recordings []resolvedRecording
}

type resolvedCredit struct {
	name     string
	role     store.CreditRole
	position int
}

type resolvedRecording struct {
	label          *string
	youTubeURL     *string
	youTubeVideoID *string
	releaseYear    *int
	notes          *string
	isFirst        bool
	position       int
	performers     []resolvedPerformer
}

type resolvedPerformer struct {
	name     string
	position int
}

// defaultLanguage matches the songs.language column default.
const defaultLanguage = "el"

// languageAliases maps common spellings onto the two-letter codes the
// `language ~ '^[a-z]{2}$'` CHECK accepts. Greek is "el" in ISO 639-1, not "gr".
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
	// Narrow a BCP-47 tag ("en-US", "el_GR") to its primary subtag.
	if i := strings.IndexAny(s, "-_"); i > 0 {
		s = s[:i]
	}
	if twoLetter.MatchString(s) {
		return s, true
	}
	return defaultLanguage, false
}

// creditClass is where a source role sends a person: onto the song as an
// authorship credit, or onto its first recording as a performer (which has no
// store.CreditRole).
type creditClass int

const (
	classComposer creditClass = iota
	classLyricist
	classPerformer
)

// creditRole maps the two authorship classes onto the schema's roles. Calling it
// on classPerformer is a bug — performers do not have one.
func (c creditClass) creditRole() store.CreditRole {
	if c == classLyricist {
		return store.CreditLyricist
	}
	return store.CreditComposer
}

// rawRoleAliases maps source vocabulary onto creditClass. In the old catalog
// "songwriter" means the lyricist and "artist" the performer. Keys are folded
// through foldKey at init.
var rawRoleAliases = map[string]creditClass{
	"artist":     classPerformer,
	"performer":  classPerformer,
	"singer":     classPerformer,
	"vocals":     classPerformer,
	"ερμηνευτής": classPerformer,
	"ερμηνεία":   classPerformer,
	"composer":   classComposer,
	"music":      classComposer,
	"μουσική":    classComposer,
	"συνθέτης":   classComposer,
	"songwriter": classLyricist,
	"lyricist":   classLyricist,
	"lyrics":     classLyricist,
	"writer":     classLyricist,
	"στίχοι":     classLyricist,
	"στιχουργός": classLyricist,
}

// roleAliases is rawRoleAliases with folded keys, built once at startup.
var roleAliases = func() map[string]creditClass {
	m := make(map[string]creditClass, len(rawRoleAliases))
	for k, v := range rawRoleAliases {
		m[foldKey(k)] = v
	}
	return m
}()

// fallbackRole files a credit with an unmapped role (reported, never dropped).
// Performer: an unknown label more likely names a performance than authorship.
const fallbackRole = classPerformer

// normalizeRole resolves a source role label, reporting whether it was
// recognized.
func normalizeRole(raw string) (creditClass, bool) {
	if strings.TrimSpace(raw) == "" {
		return fallbackRole, false
	}
	if r, ok := roleAliases[foldKey(raw)]; ok {
		return r, true
	}
	return fallbackRole, false
}

// Release year bounds mirror the `release_year BETWEEN 1000 AND 2200` CHECK;
// values outside them are stored as NULL rather than failing the import.
const (
	minReleaseYear = 1000
	maxReleaseYear = 2200
)

// youTubeIDPattern matches the 11-character video identifier.
var youTubeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// youTubeVideoID extracts the video id from a YouTube URL, or "" when the URL
// is not recognized.
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

// foldKey produces the comparison key for names, roles and titles. Slugify
// collapses the same variation app_norm does, so the cache and DB uniqueness
// agree. Values that slugify to "" fall back to trimmed lowercase.
func foldKey(s string) string {
	if k := store.Slugify(s); k != "" {
		return k
	}
	return strings.ToLower(strings.TrimSpace(s))
}

// slugFor derives a genre's slug. cleanGenres has already rejected names that
// yield "", so every name reaching the writer has a usable slug.
func slugFor(name string) string { return store.Slugify(name) }

// normalizeText converts CRLF/CR to LF and trims.
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
		return nil, errors.New("title is empty")
	}

	s := &song{
		sourceID: strings.TrimSpace(r.SourceID),
		title:    title,
		altTitle: optionalText(r.AltTitle),
		lyrics:   normalizeText(r.Lyrics),
		notes:    optionalText(r.Notes),
	}

	// An alt title repeating the title would be indexed twice.
	if s.altTitle != nil && foldKey(*s.altTitle) == foldKey(title) {
		s.altTitle = nil
	}

	lang, exact := normalizeLanguage(r.Language)
	if !exact {
		w.add("language %q not recognized, stored as %q", strings.TrimSpace(r.Language), lang)
	}
	s.language = lang

	credits, performers := cleanCredits(r.Credits, w)
	s.credits = credits
	s.genres = cleanGenres(r.Genres, w)
	s.recordings = r.cleanRecordings(performers, w)
	return s, nil
}

// cleanRecordings produces the song's recordings.
//
// An explicit `recordings` array is taken as given. Otherwise one is synthesized
// from the performers, link and year, matching migration 000009 so a re-import
// lands where the migration left it. With none of the three, no recording.
func (r record) cleanRecordings(performers []resolvedPerformer, w *warnings) []resolvedRecording {
	if len(r.Recordings) > 0 {
		if len(performers) > 0 {
			w.add("record carries both explicit recordings and %d performer credit(s); the credits were dropped",
				len(performers))
		}
		// Report the record-level link and year this branch drops, too.
		if strings.TrimSpace(derefOr(r.YouTubeURL)) != "" {
			w.add("record carries both explicit recordings and a record-level youtube_url; the link was dropped")
		}
		if r.ReleaseYear != nil {
			w.add("record carries both explicit recordings and a record-level release_year; the year was dropped")
		}
		out := make([]resolvedRecording, 0, len(r.Recordings))
		firstTaken := false
		for i, rec := range r.Recordings {
			cleaned := resolvedRecording{
				label:      optionalText(rec.Label),
				notes:      optionalText(rec.Notes),
				position:   i,
				performers: cleanPerformers(rec.Performers, w),
			}
			cleaned.youTubeURL, cleaned.youTubeVideoID = cleanVideo(rec.YouTubeURL, w)
			cleaned.releaseYear = cleanYear(rec.ReleaseYear, w)
			// A unique index allows one first per song; the first claim wins.
			if rec.IsFirst != nil && *rec.IsFirst {
				if firstTaken {
					w.add("more than one recording marked as the first; kept the earliest such")
				} else {
					firstTaken = true
					cleaned.isFirst = true
				}
			}
			out = append(out, cleaned)
		}
		return out
	}

	link, videoID := cleanVideo(r.YouTubeURL, w)
	year := cleanYear(r.ReleaseYear, w)
	if len(performers) == 0 && link == nil && year == nil {
		return nil
	}
	return []resolvedRecording{{
		youTubeURL:     link,
		youTubeVideoID: videoID,
		releaseYear:    year,
		isFirst:        true,
		performers:     performers,
	}}
}

// cleanVideo stores the link verbatim and sets the id only when it parses; an
// unparsed link loses only the watch button, and the API carries it through.
func cleanVideo(raw *string, w *warnings) (link, videoID *string) {
	trimmed := strings.TrimSpace(derefOr(raw))
	if trimmed == "" {
		return nil, nil
	}
	link = &trimmed
	if id := youTubeVideoID(trimmed); id != "" {
		videoID = &id
	} else {
		w.add("youtube_url %q yields no video id", trimmed)
	}
	return link, videoID
}

// cleanYear drops a year outside the CHECK's bounds rather than failing the row.
func cleanYear(year *int, w *warnings) *int {
	if year == nil {
		return nil
	}
	if y := *year; y >= minReleaseYear && y <= maxReleaseYear {
		return &y
	}
	w.add("release_year %d outside %d-%d, stored as NULL", *year, minReleaseYear, maxReleaseYear)
	return nil
}

// cleanPerformers drops blank names and de-duplicates on the person, which is
// the primary key of recording_credits.
func cleanPerformers(in []performer, w *warnings) []resolvedPerformer {
	seen := make(map[string]bool, len(in))
	out := make([]resolvedPerformer, 0, len(in))

	for _, p := range in {
		name := normalizeText(p.Name)
		if name == "" {
			w.add("performer with a blank name dropped")
			continue
		}
		key := foldKey(name)
		if seen[key] {
			continue
		}
		seen[key] = true

		pos := len(out)
		if p.Position != nil && *p.Position >= 0 {
			pos = *p.Position
		}
		out = append(out, resolvedPerformer{name: name, position: pos})
	}
	return out
}

// cleanCredits normalizes roles, drops blank names, de-duplicates, and splits
// authorship credits (kept on the song) from performers (sent to the recording).
// Credits de-duplicate on (person, role), song_credits' primary key; performers
// on the person alone.
func cleanCredits(in []credit, w *warnings) ([]resolvedCredit, []resolvedPerformer) {
	seen := make(map[string]bool, len(in))
	perRole := make(map[store.CreditRole]int, 2)
	credits := make([]resolvedCredit, 0, len(in))
	var performers []performer

	for _, c := range in {
		name := normalizeText(c.Name)
		if name == "" {
			w.add("credit with a blank name dropped (role %q)", strings.TrimSpace(c.Role))
			continue // a blank name would fail the people CHECK
		}
		class, known := normalizeRole(c.Role)
		if !known {
			w.add("credit role %q not recognized, treated as a performer", strings.TrimSpace(c.Role))
		}

		if class == classPerformer {
			// cleanPerformers resolves positions, as on the explicit path.
			performers = append(performers, performer{Name: name, Position: c.Position})
			continue
		}

		role := class.creditRole()
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

		credits = append(credits, resolvedCredit{name: name, role: role, position: pos})
	}
	return credits, cleanPerformers(performers, w)
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

// fingerprint identifies an already-imported song: its normalized title plus
// the order-independent set of everyone credited. Titles alone are not unique.
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

// fingerprint for an already-cleaned song. Performers count alongside credits,
// matching loadFingerprints; omitting them duplicates the catalog on re-import.
func (s *song) fingerprint() string {
	names := make([]string, 0, len(s.credits))
	for _, c := range s.credits {
		names = append(names, c.name)
	}
	for _, r := range s.recordings {
		for _, p := range r.performers {
			names = append(names, p.name)
		}
	}
	return fingerprint(s.title, names)
}

// optionalText trims an optional string, collapsing blank to nil.
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
