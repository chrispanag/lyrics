package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

type nameRequest struct {
	Name string `json:"name"`
}

// nameProblem returns the field-level message for a trimmed display name, or ""
// if the name is acceptable. Shared with the list handlers, which accumulate
// field problems and so cannot call validateName.
func nameProblem(name string) string {
	switch {
	case name == "":
		return "Name is required."
	case utf8.RuneCountInString(name) > maxNameLen:
		return "Name is too long."
	default:
		return ""
	}
}

// validateName applies the shared rules for a person or genre name.
func validateName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	switch problem := nameProblem(name); {
	case problem == "":
		return name, nil
	case name == "":
		return "", httpx.Validation("A name is required.").
			WithDetails(validationErrors{"name": problem})
	default:
		return "", httpx.Validation("The name is too long.").
			WithDetails(validationErrors{"name": problem})
	}
}

// decodeName reads the shared { "name": ... } body and validates it.
func decodeName(w http.ResponseWriter, r *http.Request) (string, error) {
	var req nameRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return "", err
	}
	return validateName(req.Name)
}

func (s *Server) handleListPeople(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	limit, offset := httpx.Pagination(q)

	filter := store.PersonFilter{
		Query:  strings.TrimSpace(q.Get("q")),
		Limit:  limit,
		Offset: offset,
	}
	// composer/lyricist match song_credits; performer (and its alias artist)
	// match recording performers, a different table.
	if role := strings.TrimSpace(q.Get("role")); role != "" {
		switch lowered := strings.ToLower(role); lowered {
		case "performer", "artist":
			filter.Performs = true
		default:
			creditRole := store.CreditRole(lowered)
			if !creditRole.Valid() {
				return httpx.BadRequest("Role must be artist, composer, lyricist, or performer.")
			}
			filter.Role = creditRole
		}
	}

	people, total, err := s.store.ListPeople(r.Context(), filter)
	if err != nil {
		return storeError(err, "People")
	}
	httpx.JSON(w, http.StatusOK, httpx.NewListResponse(people, total, limit, offset))
	return nil
}

// handleCreditedPeople enumerates the id of every person on at least one song,
// for the sitemap's catalog pages. Guest-readable, paginated, oldest first.
// Its own route rather than a mode of /people because the walk wants ids
// alone, without the per-row song count every /people row computes.
func (s *Server) handleCreditedPeople(w http.ResponseWriter, r *http.Request) error {
	limit, offset := httpx.Pagination(r.URL.Query())

	people, total, err := s.store.CreditedPeople(r.Context(), limit, offset)
	if err != nil {
		return storeError(err, "People")
	}
	httpx.JSON(w, http.StatusOK, httpx.NewListResponse(people, total, limit, offset))
	return nil
}

func (s *Server) handleGetPerson(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r)
	if err != nil {
		return err
	}
	person, err := s.store.GetPerson(r.Context(), id)
	if err != nil {
		return storeError(err, "Person")
	}
	httpx.JSON(w, http.StatusOK, person)
	return nil
}

// handleCreatePerson is an upsert: posting an existing name returns that
// person rather than a conflict, because the editor's autocomplete cannot
// guarantee the client knew about them.
func (s *Server) handleCreatePerson(w http.ResponseWriter, r *http.Request) error {
	name, err := decodeName(w, r)
	if err != nil {
		return err
	}

	person, err := s.store.UpsertPerson(r.Context(), name)
	if err != nil {
		return storeError(err, "Person")
	}
	httpx.JSON(w, http.StatusCreated, person)
	return nil
}

func (s *Server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r)
	if err != nil {
		return err
	}
	name, err := decodeName(w, r)
	if err != nil {
		return err
	}

	person, err := s.store.UpdatePerson(r.Context(), id, name)
	if err != nil {
		if store.IsConflict(err) {
			return httpx.Conflict("Another person already uses that name.").WithCause(err)
		}
		return storeError(err, "Person")
	}
	httpx.JSON(w, http.StatusOK, person)
	return nil
}

func (s *Server) handleDeletePerson(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r)
	if err != nil {
		return err
	}

	if err := s.store.DeletePerson(r.Context(), id); err != nil {
		if store.IsInUse(err) {
			return httpx.Conflict(
				"This person is still credited on songs or performs on a recording. Remove them from those songs first.").WithCause(err)
		}
		return storeError(err, "Person")
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) handleListGenres(w http.ResponseWriter, r *http.Request) error {
	genres, err := s.store.ListGenres(r.Context())
	if err != nil {
		return storeError(err, "Genres")
	}
	httpx.JSON(w, http.StatusOK, httpx.NewListResponse(genres, len(genres), len(genres), 0))
	return nil
}

func (s *Server) handleCreateGenre(w http.ResponseWriter, r *http.Request) error {
	name, err := decodeName(w, r)
	if err != nil {
		return err
	}
	// Greek names transliterate to Latin, but a name of only punctuation or an
	// unsupported script yields nothing usable.
	if store.Slugify(name) == "" {
		return httpx.Validation("The genre could not be saved.").WithDetails(
			validationErrors{"name": "Name must contain letters or numbers."})
	}

	genre, err := s.store.CreateGenre(r.Context(), name)
	if err != nil {
		if store.IsConflict(err) {
			return httpx.Conflict("That genre already exists.").WithCause(err)
		}
		return storeError(err, "Genre")
	}
	httpx.JSON(w, http.StatusCreated, genre)
	return nil
}

func (s *Server) handleUpdateGenre(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r)
	if err != nil {
		return err
	}
	name, err := decodeName(w, r)
	if err != nil {
		return err
	}

	genre, err := s.store.UpdateGenre(r.Context(), id, name)
	if err != nil {
		// Not the generic "Genre already exists.", which misreads a rename.
		if store.IsConflict(err) {
			return httpx.Conflict("Another genre already uses that name.").WithCause(err)
		}
		return storeError(err, "Genre")
	}
	httpx.JSON(w, http.StatusOK, genre)
	return nil
}

func (s *Server) handleDeleteGenre(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r)
	if err != nil {
		return err
	}
	if err := s.store.DeleteGenre(r.Context(), id); err != nil {
		return storeError(err, "Genre")
	}
	httpx.NoContent(w)
	return nil
}
