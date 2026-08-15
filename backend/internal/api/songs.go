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

	credits, creditProblems := s.resolveCredits(r, req.Credits)
	for field, message := range creditProblems {
		problems.add(field, message)
	}

	if !problems.empty() {
		return store.SongInput{}, httpx.Validation("The song could not be saved.").WithDetails(problems)
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

func (s *Server) resolveCredits(r *http.Request, requested []creditRequest) ([]store.Credit, validationErrors) {
	problems := validationErrors{}
	credits := make([]store.Credit, 0, len(requested))

	for i, c := range requested {
		field := "credits[" + strconv.Itoa(i) + "]"

		role := store.CreditRole(strings.ToLower(strings.TrimSpace(c.Role)))
		if !role.Valid() {
			problems.add(field+".role", "Role must be artist, composer, lyricist, or performer.")
			continue
		}

		switch {
		case c.PersonID != nil:
			credits = append(credits, store.Credit{PersonID: *c.PersonID, Role: role, Position: c.Position})
		case strings.TrimSpace(c.Name) != "":
			name := strings.TrimSpace(c.Name)
			if utf8.RuneCountInString(name) > maxNameLen {
				problems.add(field+".name", "Name is too long.")
				continue
			}
			person, err := s.store.UpsertPerson(r.Context(), name)
			if err != nil {
				problems.add(field+".name", "Could not be saved.")
				continue
			}
			credits = append(credits, store.Credit{PersonID: person.ID, Role: role, Position: c.Position})
		default:
			problems.add(field, "Either person_id or name is required.")
		}
	}
	return credits, problems
}

func (s *Server) handleListSongs(w http.ResponseWriter, r *http.Request) error {
	// Parsed once and passed down: url.URL.Query() re-parses RawQuery and
	// allocates a fresh map on every call, and this handler reads a dozen
	// parameters.
	q := r.URL.Query()
	limit, offset := httpx.Pagination(q)

	filter := store.SongFilter{
		Query:     strings.TrimSpace(q.Get("q")),
		GenreSlug: strings.TrimSpace(q.Get("genre_slug")),
		Language:  strings.ToLower(strings.TrimSpace(q.Get("language"))),
		Sort:      store.SongSort(q.Get("sort")),
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

	owner, err := s.store.SongOwner(r.Context(), id)
	if err != nil {
		return storeError(err, "Song")
	}

	user := auth.MustFromContext(r.Context())
	if !auth.CanEditSong(user, owner) {
		return httpx.Forbidden("You can only edit songs you added.")
	}

	var req songRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}
	input, err := s.toInput(r, req)
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
