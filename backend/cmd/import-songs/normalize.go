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
	SourceID string  `json:"source_id,omitempty"`
	Title    string  `json:"title"`
	AltTitle *string `json:"alt_title,omitempty"`
	Lyrics   string  `json:"lyrics,omitempty"`
	Language string  `json:"language,omitempty"`
	// YouTubeURL and ReleaseYear describe a performance, not the work, so they
	// are folded into a synthesized first recording when no explicit Recordings
	// are given. They stay at this level because that is the shape the old
	// catalog exports, and it is the only shape anything has ever produced.
	YouTubeURL  *string  `json:"youtube_url,omitempty"`
	ReleaseYear *int     `json:"release_year,omitempty"`
	Notes       *string  `json:"notes,omitempty"`
	Credits     []credit `json:"credits,omitempty"`
	Genres      []string `json:"genres,omitempty"`
	// Recordings, when present, replaces the synthesis: a source that knows
	// about several performances states them, and the fields above are then
	// expected to be absent. Nothing produces this yet — it exists so the next
	// source does not have to change this format to say what it knows.
	Recordings []recordingRecord `json:"recordings,omitempty"`
}

type credit struct {
	Name string `json:"name"`
	Role string `json:"role"`
	// Position orders people within one role. When absent, slice order wins,
	// which is how the exporter preserves the source's own ordering.
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

// song is a record that has passed every check the target schema imposes.
// Producing one is the only way to reach the insert path, so a CHECK violation
// at COMMIT would mean a bug here rather than bad input.
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

// creditClass is where a source role sends a person: onto the song as an
// authorship credit, or onto its first recording as a performer.
//
// A local type rather than store.CreditRole, because the destination is no
// longer one column with four values — performing is a different table now, and
// nothing about it is a role.
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

// rawRoleAliases maps source vocabulary onto those three classes.
// "songwriter" is the old catalog's own enum value and means the person who
// wrote the words, which is this schema's "lyricist". The Greek terms are here
// because the catalog is Greek-first.
//
// "artist" is a performer: it is what the old catalog called the act a song is
// known by, which is a performance of it and not its authorship.
//
// Keys are written readably and folded through foldKey at init, so lookups
// tolerate the same casing and accent variation the rest of the schema does.
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

// fallbackRole is used when a source role has no mapping. Dropping the credit
// would silently strip attribution, which is worse than filing someone in the
// likeliest place — and every fallback is reported.
//
// Performer, because an unrecognized label is far more often a way of saying
// who played it than a claim about who wrote it: authorship vocabulary is
// small and well covered above, while the ways of naming a performance are
// not. Guessing authorship also asserts more than guessing performance does.
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

	credits, performers := cleanCredits(r.Credits, w)
	s.credits = credits
	s.genres = cleanGenres(r.Genres, w)
	s.recordings = r.cleanRecordings(performers, w)
	return s, nil
}

// cleanRecordings produces the song's recordings.
//
// An explicit `recordings` array is taken as given. Otherwise one is synthesized
// from whatever the record says about a performance — the performers split out
// of its credits, its link, its year — which is the same thing migration 000009
// did to the rows already in the catalog, and it has to stay the same thing: a
// re-import of the old export must land where the migration left it.
//
// A record with none of the three gets no recording at all. There would be
// nothing in it, and an empty recording claims a performance nobody described.
func (r record) cleanRecordings(performers []resolvedPerformer, w *warnings) []resolvedRecording {
	if len(r.Recordings) > 0 {
		if len(performers) > 0 {
			w.add("record carries both explicit recordings and %d performer credit(s); the credits were dropped",
				len(performers))
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
			// One first per song is a unique index, so a source claiming two
			// would fail the whole transaction. The first claim wins.
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

	url, videoID := cleanVideo(r.YouTubeURL, w)
	year := cleanYear(r.ReleaseYear, w)
	if len(performers) == 0 && url == nil && year == nil {
		return nil
	}
	return []resolvedRecording{{
		youTubeURL:     url,
		youTubeVideoID: videoID,
		releaseYear:    year,
		isFirst:        true,
		performers:     performers,
	}}
}

// cleanVideo stores the link verbatim and sets the id only when it parses.
//
// Keeping a link this program cannot read is deliberate: the id is what the app
// builds its watch link from, so an unparsed one costs the button and nothing
// else, where dropping the URL would lose the only record that a video exists.
// The API refuses such a link on a write but carries a stored one through, which
// is the arrangement that makes this safe.
func cleanVideo(raw *string, w *warnings) (url *string, videoID *string) {
	trimmed := strings.TrimSpace(derefOr(raw))
	if trimmed == "" {
		return nil, nil
	}
	url = &trimmed
	if id := youTubeVideoID(trimmed); id != "" {
		videoID = &id
	} else {
		w.add("youtube_url %q yields no video id", trimmed)
	}
	return url, videoID
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
// the result in two: the authorship credits stay on the song, and the performers
// go to its recording.
//
// Credits de-duplicate on (person, role) — the primary key of song_credits,
// which a source listing the same writer twice in one capacity would otherwise
// violate mid-transaction — and performers on the person alone, since
// recording_credits has no role to tell two of them apart.
func cleanCredits(in []credit, w *warnings) ([]resolvedCredit, []resolvedPerformer) {
	seen := make(map[string]bool, len(in))
	perRole := make(map[store.CreditRole]int, 2)
	credits := make([]resolvedCredit, 0, len(in))
	var performers []performer

	for _, c := range in {
		name := normalizeText(c.Name)
		if name == "" {
			// Reported like every other adjustment in this file. Silently
			// dropping it hid the export's own NULL-name bug behind a clean
			// warning report while whole artists arrived with no credits.
			w.add("credit with a blank name dropped (role %q)", strings.TrimSpace(c.Role))
			continue // a blank name would fail the people CHECK
		}
		class, known := normalizeRole(c.Role)
		if !known {
			w.add("credit role %q not recognized, treated as a performer", strings.TrimSpace(c.Role))
		}

		if class == classPerformer {
			// Positions are resolved by cleanPerformers, which is also what the
			// explicit path uses — one place deciding how performers are ordered.
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
//
// Performers count towards it alongside the credits, and have to: they are the
// same people who used to arrive as `artist` credits, so leaving them out would
// give a re-import of the same export a different fingerprint from the one the
// migrated row has, and every song would be inserted a second time.
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
