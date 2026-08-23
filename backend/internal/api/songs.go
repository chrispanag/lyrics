package api

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

// creditRequest identifies a credited person either by ID or by name.
//
// Accepting a bare name lets the editor create a person inline, which is how
// most credits actually get entered — requiring a separate "create person" call
// first would make adding a song a multi-step chore.
type creditRequest struct {
	PersonID *uuid.UUID `json:"person_id"`
	Name     string     `json:"name"`
	Role     string     `json:"role"`
	Position int        `json:"position"`
}

// recordingPerformerRequest names a performer the same two ways a credit names
// a person: by id, or by a name for one to be created.
type recordingPerformerRequest struct {
	PersonID *uuid.UUID `json:"person_id"`
	Name     string     `json:"name"`
	Position int        `json:"position"`
}

// recordingRequest is one recording as written. No video id: it is derived from
// the URL here, exactly as the song's used to be, so a caller cannot state a
// link and an id that disagree.
type recordingRequest struct {
	Label       *string                     `json:"label"`
	YouTubeURL  *string                     `json:"youtube_url"`
	ReleaseYear *int                        `json:"release_year"`
	Notes       *string                     `json:"notes"`
	IsFirst     bool                        `json:"is_first"`
	Position    int                         `json:"position"`
	Performers  []recordingPerformerRequest `json:"performers"`
}

// songRequest is the full write shape.
//
// The YouTube link and the release year are gone from it: both belong to a
// recording now, and the song's copies are written by trigger. A payload still
// naming them is refused outright rather than ignored, because DecodeJSON
// disallows unknown fields — which is the right way round. Silently dropping a
// link the caller believed it had saved is the failure that would be worth
// avoiding a breaking change for.
type songRequest struct {
	Title      string             `json:"title"`
	AltTitle   *string            `json:"alt_title"`
	Lyrics     string             `json:"lyrics"`
	Language   string             `json:"language"`
	Notes      *string            `json:"notes"`
	Credits    []creditRequest    `json:"credits"`
	GenreIDs   []uuid.UUID        `json:"genre_ids"`
	Recordings []recordingRequest `json:"recordings"`
}

// songPatchRequest is the PATCH shape for a song: every field is optional, and
// an absent one means "leave it alone".
//
// Without this the route decoded the same full songRequest that POST uses, so
// `PATCH {"title": "Fixed typo"}` blanked the lyrics, dropped every credit and
// genre, and reset the language to its default. Nothing failed and nothing
// warned — the response was a 200 carrying the emptied song. It only stayed
// invisible because the one client always sends the whole record.
type songPatchRequest struct {
	Title    *string          `json:"title"`
	AltTitle optionalString   `json:"alt_title"`
	Lyrics   *string          `json:"lyrics"`
	Language *string          `json:"language"`
	Notes    optionalString   `json:"notes"`
	Credits  *[]creditRequest `json:"credits"`
	GenreIDs *[]uuid.UUID     `json:"genre_ids"`
	// Recordings follows the collection idiom rather than the optional* one: a
	// nil pointer is an absent key, and an explicit `[]` removes them all.
	Recordings *[]recordingRequest `json:"recordings"`
}

// merge overlays the patch onto the stored song, producing the full payload
// toInput already knows how to validate. Doing it this way keeps one validation
// path for create and update rather than a second copy that can drift.
//
// `existing` must come from a single-song read: a listing projects the body
// away, and a PATCH that leaves lyrics alone would then write back the blank it
// found. The deref is deliberately unguarded — the caller reads GetSong, and a
// nil there is a wiring mistake worth a stack trace rather than a song quietly
// emptied of its lyrics.
func (p songPatchRequest) merge(existing *store.Song) songRequest {
	req := songRequest{
		Title:      existing.Title,
		AltTitle:   existing.AltTitle,
		Lyrics:     *existing.Lyrics,
		Language:   existing.Language,
		Notes:      existing.Notes,
		Credits:    creditRequestsFor(existing.Credits),
		GenreIDs:   genreIDsFor(existing.Genres),
		Recordings: recordingRequestsFor(existing.Recordings),
	}

	if p.Title != nil {
		req.Title = *p.Title
	}
	if p.Lyrics != nil {
		req.Lyrics = *p.Lyrics
	}
	if p.Language != nil {
		req.Language = *p.Language
	}
	// The optional* fields carry their own "was it present" flag, which is what
	// separates "leave alone" from an explicit null meaning "clear it".
	if p.AltTitle.Set {
		req.AltTitle = p.AltTitle.Value
	}
	if p.Notes.Set {
		req.Notes = p.Notes.Value
	}
	// A nil slice pointer is an absent key; an explicit `[]` is "remove them
	// all", which a plain []T could not tell apart.
	if p.Credits != nil {
		req.Credits = *p.Credits
	}
	if p.GenreIDs != nil {
		req.GenreIDs = *p.GenreIDs
	}
	if p.Recordings != nil {
		req.Recordings = *p.Recordings
	}
	return req
}

// creditRequestsFor restates stored credits in request form, by person ID so
// the round trip cannot re-upsert or rename anyone.
func creditRequestsFor(credits []store.Credit) []creditRequest {
	out := make([]creditRequest, len(credits))
	for i, c := range credits {
		personID := c.PersonID
		out[i] = creditRequest{PersonID: &personID, Role: string(c.Role), Position: c.Position}
	}
	return out
}

// recordingRequestsFor restates stored recordings in request form, performers
// by person ID like the credits above.
//
// The YouTube link is restated exactly as stored — not canonicalized, not
// re-parsed. That is what carries an unparseable imported link through a PATCH
// that never meant to touch it: toInput recognizes the string as one already on
// the song and lets it past. Rewriting it here in any way would break that
// match and answer 422 naming a field the caller never sent.
func recordingRequestsFor(recordings []store.Recording) []recordingRequest {
	out := make([]recordingRequest, len(recordings))
	for i, r := range recordings {
		performers := make([]recordingPerformerRequest, len(r.Performers))
		for j, p := range r.Performers {
			personID := p.PersonID
			performers[j] = recordingPerformerRequest{PersonID: &personID, Position: p.Position}
		}
		out[i] = recordingRequest{
			Label:       r.Label,
			YouTubeURL:  r.YouTubeURL,
			ReleaseYear: r.ReleaseYear,
			Notes:       r.Notes,
			IsFirst:     r.IsFirst,
			Position:    r.Position,
			Performers:  performers,
		}
	}
	return out
}

func genreIDsFor(genres []store.Genre) []uuid.UUID {
	out := make([]uuid.UUID, len(genres))
	for i, g := range genres {
		out[i] = g.ID
	}
	return out
}

// storedRecordingURLs indexes the song's recordings by their stored YouTube
// link, trimmed. A create has no song and so gets an empty map, which is what
// keeps it from ever exempting anything.
//
// Keyed on the URL rather than on a recording id because ids do not survive a
// write: replaceRelations replaces the recordings wholesale and mints new ones.
// The string is the durable identity here, and it is exactly the right test —
// "the caller sent back what was already stored" is the whole condition the
// exemption turns on. Two recordings sharing one link is pathological but
// harmless; the first wins and they carry the same value anyway.
func storedRecordingURLs(existing *store.Song) map[string]*store.Recording {
	stored := map[string]*store.Recording{}
	if existing == nil {
		return stored
	}
	for i := range existing.Recordings {
		r := &existing.Recordings[i]
		if r.YouTubeURL == nil {
			continue
		}
		if u := strings.TrimSpace(*r.YouTubeURL); u != "" {
			if _, seen := stored[u]; !seen {
				stored[u] = r
			}
		}
	}
	return stored
}

// toInput validates the payload and resolves credits and performers into store
// rows, creating people named inline as it goes.
//
// `existing` is the song being updated, or nil on create. It is consulted for
// one thing only — see the recordings block — and every other field is
// validated the same way on both paths.
func (s *Server) toInput(r *http.Request, req songRequest, existing *store.Song) (store.SongInput, error) {
	problems := validationErrors{}

	title := strings.TrimSpace(req.Title)
	switch {
	case title == "":
		problems.add("title", "Title is required.")
	case utf8.RuneCountInString(title) > maxTitleLen:
		problems.add("title", "Title is too long.")
	}

	if utf8.RuneCountInString(req.Lyrics) > maxLyricsLen {
		problems.add("lyrics", "Lyrics are too long.")
	}

	language := strings.ToLower(strings.TrimSpace(req.Language))
	if language == "" {
		language = "el"
	}
	if !languagePattern.MatchString(language) {
		problems.add("language", "Language must be a two-letter code such as \"el\" or \"en\".")
	}

	notes := trimmedPtr(req.Notes)
	if notes != nil && utf8.RuneCountInString(*notes) > maxNotesLen {
		problems.add("notes", "Notes are too long.")
	}

	if len(req.GenreIDs) > maxGenreRefs {
		problems.add("genre_ids", "Too many genres.")
	}
	checkCredits(req.Credits, problems)
	checkRecordings(req.Recordings, problems)

	// The recordings' links, canonicalized one by one. This runs before the
	// early return so a bad link joins whatever else the payload got wrong,
	// rather than costing the caller a second round trip to find out about.
	stored := storedRecordingURLs(existing)
	links := make([]recordingLink, len(req.Recordings))
	for i, rec := range req.Recordings {
		trimmed := trimmedPtr(rec.YouTubeURL)
		if trimmed == nil {
			continue
		}
		id, ok := parseYouTubeURL(*trimmed)
		switch {
		case ok:
			// Store a canonical URL rather than whatever was pasted, so tracking
			// parameters and shortened forms do not accumulate in the catalog.
			canonical := "https://www.youtube.com/watch?v=" + id
			links[i] = recordingLink{url: &canonical, videoID: &id}

		case stored[*trimmed] != nil:
			// A link this API refused is nonetheless already in the catalog: the
			// importer stores youtube_url verbatim and sets the id only when it
			// parses (cmd/import-songs/normalize.go), so the rows it left behind
			// carry URLs no write path here would accept.
			//
			// merge fills every omitted field in from the stored song, and the
			// editor sends the whole record hydrated the same way, so that URL
			// arrives on a PATCH that never meant to touch it — and validating it
			// answered 422 naming a field the contributor had not edited. Fixing a
			// typo in the lyrics was then impossible without also clearing the
			// link, which is the one thing the request was not asking for.
			//
			// Refusing it is only right for a value the caller chose. Unchanged
			// from what is stored, both columns carry through exactly as they are
			// — no canonicalization, since there is no id to build one from.
			match := stored[*trimmed]
			links[i] = recordingLink{url: match.YouTubeURL, videoID: match.YouTubeVideoID}

		default:
			problems.add(recordingField(i)+".youtube_url", "Not a recognizable YouTube link.")
		}
	}

	if !problems.empty() {
		return store.SongInput{}, httpx.Validation("The song could not be saved.").WithDetails(problems)
	}

	// Resolved only once the whole payload has been accepted. resolveCredits
	// creates a `people` row for every name typed inline, and those writes are
	// committed outside the song's transaction — so doing them during
	// validation left a permanent person behind on every request the server
	// then rejected, with no way for a non-admin to remove it.
	credits, creditProblems := s.resolveCredits(r, req.Credits)
	if !creditProblems.empty() {
		return store.SongInput{}, httpx.Validation("The song could not be saved.").WithDetails(creditProblems)
	}

	recordings, recordingProblems := s.resolveRecordings(r, req.Recordings, links)
	if !recordingProblems.empty() {
		return store.SongInput{}, httpx.Validation("The song could not be saved.").WithDetails(recordingProblems)
	}

	return store.SongInput{
		Title:      title,
		AltTitle:   trimmedPtr(req.AltTitle),
		Lyrics:     req.Lyrics,
		Language:   language,
		Notes:      notes,
		Credits:    credits,
		GenreIDs:   req.GenreIDs,
		Recordings: recordings,
	}, nil
}

// creditField names a credit by its index for the field-level error map.
func creditField(i int) string { return "credits[" + strconv.Itoa(i) + "]" }

// recordingField names a recording by its index, and performerField one of its
// performers, for the field-level error map. The editor looks its per-row
// messages up by exactly these keys.
func recordingField(i int) string { return "recordings[" + strconv.Itoa(i) + "]" }

func performerField(i, j int) string {
	return recordingField(i) + ".performers[" + strconv.Itoa(j) + "]"
}

// recordingLink is a recording's link as it will be stored: the canonical URL
// and the id parsed out of it, or a stored pair carried through unchanged.
type recordingLink struct {
	url     *string
	videoID *string
}

// creditRole normalizes the requested role. The second result reports whether
// it is one the schema accepts.
func (c creditRequest) creditRole() (store.CreditRole, bool) {
	role := store.CreditRole(strings.ToLower(strings.TrimSpace(c.Role)))
	return role, role.Valid()
}

// checkCredits validates the shape of the credit list without touching the
// database, so a payload that will be rejected never reaches the person upsert.
func checkCredits(requested []creditRequest, problems validationErrors) {
	if len(requested) > maxCredits {
		problems.add("credits", "Too many credits.")
		return
	}

	for i, c := range requested {
		field := creditField(i)

		if _, ok := c.creditRole(); !ok {
			problems.add(field+".role", "Role must be composer or lyricist.")
			continue
		}
		if c.PersonID != nil {
			continue
		}
		name := strings.TrimSpace(c.Name)
		switch {
		case name == "":
			problems.add(field, "Either person_id or name is required.")
		case utf8.RuneCountInString(name) > maxNameLen:
			problems.add(field+".name", "Name is too long.")
		}
	}
}

// checkRecordings validates the shape of the recording list without touching
// the database, for the same reason checkCredits does: a rejected payload must
// not leave people behind it.
func checkRecordings(requested []recordingRequest, problems validationErrors) {
	if len(requested) > maxRecordings {
		problems.add("recordings", "Too many recordings.")
		return
	}

	performers := 0
	firsts := 0
	for _, rec := range requested {
		performers += len(rec.Performers)
		if rec.IsFirst {
			firsts++
		}
	}
	if performers > maxPerformers {
		problems.add("recordings", "Too many performers.")
		return
	}
	// The database refuses this too, as a unique violation on
	// recordings_one_first_per_song, but a 409 naming an index is no use to a
	// form. Caught here it is a 422 against the field the radio buttons write.
	if firsts > 1 {
		problems.add("recordings", "At most one recording can be marked as the first.")
	}

	for i, rec := range requested {
		field := recordingField(i)

		if label := trimmedPtr(rec.Label); label != nil && utf8.RuneCountInString(*label) > maxLabelLen {
			problems.add(field+".label", "Label is too long.")
		}
		if notes := trimmedPtr(rec.Notes); notes != nil && utf8.RuneCountInString(*notes) > maxNotesLen {
			problems.add(field+".notes", "Notes are too long.")
		}
		if rec.ReleaseYear != nil && (*rec.ReleaseYear < 1000 || *rec.ReleaseYear > 2200) {
			problems.add(field+".release_year", "Release year must be between 1000 and 2200.")
		}

		for j, p := range rec.Performers {
			if p.PersonID != nil {
				continue
			}
			name := strings.TrimSpace(p.Name)
			switch {
			case name == "":
				problems.add(performerField(i, j), "Either person_id or name is required.")
			case utf8.RuneCountInString(name) > maxNameLen:
				problems.add(performerField(i, j)+".name", "Name is too long.")
			}
		}
	}
}

// resolvePerson names a person by id, or creates one from a typed name. The
// error is left to the caller to key, since the field path differs between a
// credit and a recording's performer.
func (s *Server) resolvePerson(r *http.Request, personID *uuid.UUID, name string) (uuid.UUID, error) {
	if personID != nil {
		return *personID, nil
	}
	person, err := s.store.UpsertPerson(r.Context(), strings.TrimSpace(name))
	if err != nil {
		return uuid.Nil, err
	}
	return person.ID, nil
}

// resolveCredits turns checked credits into store rows, creating the people
// named inline as it goes. It assumes checkCredits has already passed, so the
// only failure it can report is the upsert itself.
func (s *Server) resolveCredits(r *http.Request, requested []creditRequest) ([]store.Credit, validationErrors) {
	problems := validationErrors{}
	credits := make([]store.Credit, 0, len(requested))

	for i, c := range requested {
		role, _ := c.creditRole()

		personID, err := s.resolvePerson(r, c.PersonID, c.Name)
		if err != nil {
			problems.add(creditField(i)+".name", "Could not be saved.")
			continue
		}
		credits = append(credits, store.Credit{PersonID: personID, Role: role, Position: c.Position})
	}
	return credits, problems
}

// resolveRecordings turns checked recordings into store rows, pairing each with
// the link canonicalized for it in toInput and creating any performer named
// inline. Like resolveCredits, it runs only after the whole payload passed.
func (s *Server) resolveRecordings(
	r *http.Request,
	requested []recordingRequest,
	links []recordingLink,
) ([]store.RecordingInput, validationErrors) {
	problems := validationErrors{}
	recordings := make([]store.RecordingInput, 0, len(requested))

	for i, rec := range requested {
		performers := make([]store.RecordingPerformer, 0, len(rec.Performers))
		for j, p := range rec.Performers {
			personID, err := s.resolvePerson(r, p.PersonID, p.Name)
			if err != nil {
				problems.add(performerField(i, j)+".name", "Could not be saved.")
				continue
			}
			performers = append(performers, store.RecordingPerformer{
				PersonID: personID,
				Position: p.Position,
			})
		}

		recordings = append(recordings, store.RecordingInput{
			Label:          trimmedPtr(rec.Label),
			YouTubeURL:     links[i].url,
			YouTubeVideoID: links[i].videoID,
			ReleaseYear:    rec.ReleaseYear,
			Notes:          trimmedPtr(rec.Notes),
			IsFirst:        rec.IsFirst,
			Position:       rec.Position,
			Performers:     performers,
		})
	}
	return recordings, problems
}

func (s *Server) handleListSongs(w http.ResponseWriter, r *http.Request) error {
	// Parsed once and passed down: url.URL.Query() re-parses RawQuery and
	// allocates a fresh map on every call, and this handler reads a dozen
	// parameters.
	q := r.URL.Query()
	limit, offset := httpx.Pagination(q)

	// Rejected rather than ignored: orderClause falls through to newest-first for
	// anything it does not recognize, so a typo used to return a different
	// ordering than the one asked for, with nothing to tell the client apart
	// from a catalog that had changed.
	sort := store.SongSort(strings.ToLower(strings.TrimSpace(q.Get("sort"))))
	if !sort.Valid() {
		return httpx.BadRequest("Sort must be relevance, title, newest, or oldest.")
	}

	filter := store.SongFilter{
		Query:     strings.TrimSpace(q.Get("q")),
		GenreSlug: strings.TrimSpace(q.Get("genre_slug")),
		Language:  strings.ToLower(strings.TrimSpace(q.Get("language"))),
		Sort:      sort,
		Limit:     limit,
		Offset:    offset,
	}

	var err error
	if filter.PersonID, err = queryUUID(q, "person"); err != nil {
		return err
	}
	// `artist` and `performer` name the same filter. The honest name is the new
	// one — since 000009 the role is gone and performing is what is being asked
	// about — but links filtered by `artist` are bookmarked and shared, so the
	// old spelling keeps working. Both at once is refused rather than silently
	// resolved by precedence, which would answer a question neither asked.
	performer, err := queryUUID(q, "performer")
	if err != nil {
		return err
	}
	artist, err := queryUUID(q, "artist")
	if err != nil {
		return err
	}
	if performer != nil && artist != nil {
		return httpx.BadRequest("Use either performer or artist, not both.")
	}
	if performer != nil {
		filter.PerformerID = performer
	} else {
		filter.PerformerID = artist
	}
	if filter.ComposerID, err = queryUUID(q, "composer"); err != nil {
		return err
	}
	if filter.LyricistID, err = queryUUID(q, "lyricist"); err != nil {
		return err
	}
	if filter.GenreID, err = queryUUID(q, "genre"); err != nil {
		return err
	}
	if filter.CreatedBy, err = queryUUID(q, "created_by"); err != nil {
		return err
	}
	if filter.YearFrom, err = queryInt(q, "year_from"); err != nil {
		return err
	}
	if filter.YearTo, err = queryInt(q, "year_to"); err != nil {
		return err
	}

	songs, total, err := s.store.ListSongs(r.Context(), filter)
	if err != nil {
		return storeError(err, "Songs")
	}

	httpx.JSON(w, http.StatusOK, httpx.NewListResponse(songs, total, limit, offset))
	return nil
}

func queryInt(q url.Values, name string) (*int, error) {
	raw := strings.TrimSpace(q.Get(name))
	if raw == "" {
		return nil, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return nil, httpx.BadRequest("Query parameter %q must be a number.", name)
	}
	return &v, nil
}

func (s *Server) handleGetSong(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}
	song, err := s.store.GetSong(r.Context(), id)
	if err != nil {
		return storeError(err, "Song")
	}
	httpx.JSON(w, http.StatusOK, song)
	return nil
}

func (s *Server) handleCreateSong(w http.ResponseWriter, r *http.Request) error {
	var req songRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}

	input, err := s.toInput(r, req, nil)
	if err != nil {
		return err
	}

	user := auth.MustFromContext(r.Context())
	song, err := s.store.CreateSong(r.Context(), input, user.ID)
	if err != nil {
		return storeError(err, "Song")
	}

	httpx.JSON(w, http.StatusCreated, song)
	return nil
}

func (s *Server) handleUpdateSong(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}

	// The whole song is loaded rather than just its owner: the patch is overlaid
	// on it, so every field the caller omitted keeps the value it already had.
	existing, err := s.store.GetSong(r.Context(), id)
	if err != nil {
		return storeError(err, "Song")
	}

	user := auth.MustFromContext(r.Context())
	if !auth.CanEditSong(user, existing.CreatedBy) {
		return httpx.Forbidden("You can only edit songs you added.")
	}

	var patch songPatchRequest
	if err := httpx.DecodeJSON(w, r, &patch); err != nil {
		return err
	}
	input, err := s.toInput(r, patch.merge(existing), existing)
	if err != nil {
		return err
	}

	song, err := s.store.UpdateSong(r.Context(), id, input, user.ID)
	if err != nil {
		return storeError(err, "Song")
	}

	httpx.JSON(w, http.StatusOK, song)
	return nil
}

func (s *Server) handleDeleteSong(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}
	if err := s.store.DeleteSong(r.Context(), id); err != nil {
		return storeError(err, "Song")
	}
	httpx.NoContent(w)
	return nil
}
