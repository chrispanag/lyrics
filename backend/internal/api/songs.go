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

type songRequest struct {
	Title       string          `json:"title"`
	AltTitle    *string         `json:"alt_title"`
	Lyrics      string          `json:"lyrics"`
	Language    string          `json:"language"`
	YouTubeURL  *string         `json:"youtube_url"`
	ReleaseYear *int            `json:"release_year"`
	Notes       *string         `json:"notes"`
	Credits     []creditRequest `json:"credits"`
	GenreIDs    []uuid.UUID     `json:"genre_ids"`
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
	Title       *string          `json:"title"`
	AltTitle    optionalString   `json:"alt_title"`
	Lyrics      *string          `json:"lyrics"`
	Language    *string          `json:"language"`
	YouTubeURL  optionalString   `json:"youtube_url"`
	ReleaseYear optionalInt      `json:"release_year"`
	Notes       optionalString   `json:"notes"`
	Credits     *[]creditRequest `json:"credits"`
	GenreIDs    *[]uuid.UUID     `json:"genre_ids"`
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
		Title:       existing.Title,
		AltTitle:    existing.AltTitle,
		Lyrics:      *existing.Lyrics,
		Language:    existing.Language,
		YouTubeURL:  existing.YouTubeURL,
		ReleaseYear: existing.ReleaseYear,
		Notes:       existing.Notes,
		Credits:     creditRequestsFor(existing.Credits),
		GenreIDs:    genreIDsFor(existing.Genres),
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
	if p.YouTubeURL.Set {
		req.YouTubeURL = p.YouTubeURL.Value
	}
	if p.Notes.Set {
		req.Notes = p.Notes.Value
	}
	if p.ReleaseYear.Set {
		req.ReleaseYear = p.ReleaseYear.Value
	}
	// A nil slice pointer is an absent key; an explicit `[]` is "remove them
	// all", which a plain []T could not tell apart.
	if p.Credits != nil {
		req.Credits = *p.Credits
	}
	if p.GenreIDs != nil {
		req.GenreIDs = *p.GenreIDs
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

func genreIDsFor(genres []store.Genre) []uuid.UUID {
	out := make([]uuid.UUID, len(genres))
	for i, g := range genres {
		out[i] = g.ID
	}
	return out
}

// toInput validates the payload and resolves credits into store rows, creating
// people named inline as it goes.
func (s *Server) toInput(r *http.Request, req songRequest) (store.SongInput, error) {
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

	if req.ReleaseYear != nil && (*req.ReleaseYear < 1000 || *req.ReleaseYear > 2200) {
		problems.add("release_year", "Release year must be between 1000 and 2200.")
	}

	var youTubeURL, youTubeID *string
	if trimmed := trimmedPtr(req.YouTubeURL); trimmed != nil {
		id, ok := parseYouTubeURL(*trimmed)
		if !ok {
			problems.add("youtube_url", "Not a recognizable YouTube link.")
		} else {
			// Store a canonical URL rather than whatever was pasted, so tracking
			// parameters and shortened forms do not accumulate in the catalog.
			canonical := "https://www.youtube.com/watch?v=" + id
			youTubeURL, youTubeID = &canonical, &id
		}
	}

	if len(req.GenreIDs) > maxGenreRefs {
		problems.add("genre_ids", "Too many genres.")
	}
	checkCredits(req.Credits, problems)

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

	return store.SongInput{
		Title:          title,
		AltTitle:       trimmedPtr(req.AltTitle),
		Lyrics:         req.Lyrics,
		Language:       language,
		YouTubeURL:     youTubeURL,
		YouTubeVideoID: youTubeID,
		ReleaseYear:    req.ReleaseYear,
		Notes:          notes,
		Credits:        credits,
		GenreIDs:       req.GenreIDs,
	}, nil
}

// creditField names a credit by its index for the field-level error map.
func creditField(i int) string { return "credits[" + strconv.Itoa(i) + "]" }

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
			problems.add(field+".role", "Role must be artist, composer, lyricist, or performer.")
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

// resolveCredits turns checked credits into store rows, creating the people
// named inline as it goes. It assumes checkCredits has already passed, so the
// only failure it can report is the upsert itself.
func (s *Server) resolveCredits(r *http.Request, requested []creditRequest) ([]store.Credit, validationErrors) {
	problems := validationErrors{}
	credits := make([]store.Credit, 0, len(requested))

	for i, c := range requested {
		role, _ := c.creditRole()

		if c.PersonID != nil {
			credits = append(credits, store.Credit{PersonID: *c.PersonID, Role: role, Position: c.Position})
			continue
		}

		person, err := s.store.UpsertPerson(r.Context(), strings.TrimSpace(c.Name))
		if err != nil {
			problems.add(creditField(i)+".name", "Could not be saved.")
			continue
		}
		credits = append(credits, store.Credit{PersonID: person.ID, Role: role, Position: c.Position})
	}
	return credits, problems
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
	if filter.ArtistID, err = queryUUID(q, "artist"); err != nil {
		return err
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

	input, err := s.toInput(r, req)
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
	input, err := s.toInput(r, patch.merge(existing))
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
