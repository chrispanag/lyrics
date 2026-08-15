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
// if the name is acceptable. The rule is shared with the list handlers, which
// accumulate field problems instead of failing on the first one and so cannot
// call validateName — without this, the limit and both messages were written
// out three times and could be changed in two.
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
	// The envelope summary reads as a sentence about the request while the
	// detail is the field label, so the two are worded differently on purpose.
	// Only the field wording is shared; the summaries stay constant format
	// strings, which is what httpx.Validation expects.
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

// decodeName reads the shared { "name": ... } body and validates it. Four
// handlers take exactly this payload; written out per handler, any change to
// name intake had to be made in four places and was easy to make in three.
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
	if role := strings.TrimSpace(q.Get("role")); role != "" {
		creditRole := store.CreditRole(strings.ToLower(role))
		if !creditRole.Valid() {
			return httpx.BadRequest("Role must be artist, composer, lyricist, or performer.")
		}
		filter.Role = creditRole
	}

	people, total, err := s.store.ListPeople(r.Context(), filter)
	if err != nil {
		return storeError(err, "People")
	}
	httpx.JSON(w, http.StatusOK, httpx.NewListResponse(people, total, limit, offset))
	return nil
}

func (s *Server) handleGetPerson(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r, "id")
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
	id, err := urlUUID(r, "id")
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
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}

	if err := s.store.DeletePerson(r.Context(), id); err != nil {
		// The store classifies the RESTRICT-ed foreign key itself, so this reads
		// a predicate rather than matching a constraint name out of the message.
		if store.IsInUse(err) {
			return httpx.Conflict(
				"This person is still credited on songs. Remove those credits first.").WithCause(err)
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
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}
	name, err := decodeName(w, r)
	if err != nil {
		return err
	}

	genre, err := s.store.UpdateGenre(r.Context(), id, name)
	if err != nil {
		return storeError(err, "Genre")
	}
	httpx.JSON(w, http.StatusOK, genre)
	return nil
}

func (s *Server) handleDeleteGenre(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}
	if err := s.store.DeleteGenre(r.Context(), id); err != nil {
		return storeError(err, "Genre")
	}
	httpx.NoContent(w)
	return nil
}
