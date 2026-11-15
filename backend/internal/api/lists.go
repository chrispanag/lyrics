package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

type listRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
	IsPublic    *bool   `json:"is_public"`
}

type listPatchRequest struct {
	Name        optionalString `json:"name"`
	Description optionalString `json:"description"`
	IsPublic    optionalBool   `json:"is_public"`
}

func (s *Server) handleListLists(w http.ResponseWriter, r *http.Request) error {
	user := auth.MustFromContext(r.Context())

	lists, err := s.store.ListsForOwner(r.Context(), user.ID)
	if err != nil {
		return storeError(err, "Lists")
	}
	httpx.JSON(w, http.StatusOK, httpx.NewListResponse(lists, len(lists), len(lists), 0))
	return nil
}

// readableList loads a list the caller is allowed to see: a public one, or one
// of their own. Anything else is 404, not 403, so private lists cannot be
// probed. It checks the row alone, before loading the songs.
func (s *Server) readableList(r *http.Request) (*store.List, error) {
	id, err := urlUUID(r, "id")
	if err != nil {
		return nil, err
	}

	list, err := s.store.GetList(r.Context(), id)
	if err != nil {
		return nil, storeError(err, "List")
	}

	// Nil-safe: guests reach this too.
	user := auth.FromContext(r.Context())
	if !list.IsPublic && (user == nil || user.ID != list.OwnerID) {
		return nil, httpx.NotFound("List was not found.")
	}
	return list, nil
}

// handleGetList serves a single list with its songs.
func (s *Server) handleGetList(w http.ResponseWriter, r *http.Request) error {
	list, err := s.readableList(r)
	if err != nil {
		return err
	}

	songs, err := s.store.SongsInList(r.Context(), list.ID)
	if err != nil {
		return storeError(err, "List")
	}
	list.Songs = songs

	httpx.JSON(w, http.StatusOK, list)
	return nil
}

func (s *Server) handleCreateList(w http.ResponseWriter, r *http.Request) error {
	var req listRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}

	name := strings.TrimSpace(req.Name)
	problems := validationErrors{}
	if msg := nameProblem(name); msg != "" {
		problems.add("name", msg)
	}
	description := trimmedPtr(req.Description)
	if description != nil && utf8.RuneCountInString(*description) > maxDescriptionLen {
		problems.add("description", "Description is too long.")
	}
	if !problems.empty() {
		return httpx.Validation("The list could not be saved.").WithDetails(problems)
	}

	isPublic := req.IsPublic != nil && *req.IsPublic
	user := auth.MustFromContext(r.Context())

	list, err := s.store.CreateList(r.Context(), user.ID, name, description, isPublic)
	if err != nil {
		if store.IsConflict(err) {
			return httpx.Conflict("You already have a list with that name.").WithCause(err)
		}
		return storeError(err, "List")
	}

	httpx.JSON(w, http.StatusCreated, list)
	return nil
}

// handleCopyList duplicates a list the caller can read into an independent
// list they own.
func (s *Server) handleCopyList(w http.ResponseWriter, r *http.Request) error {
	// Before decoding the body, so no reply distinguishes a private list from a
	// missing one.
	source, err := s.readableList(r)
	if err != nil {
		return err
	}
	user := auth.MustFromContext(r.Context())

	var req struct {
		Name *string `json:"name"`
	}
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}

	// Names are unique per owner; omitting one keeps the original's.
	name := source.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
	}
	if msg := nameProblem(name); msg != "" {
		return httpx.Validation("The list could not be copied.").
			WithDetails(validationErrors{"name": msg})
	}

	copied, err := s.store.CopyList(r.Context(), source.ID, user.ID, name)
	if err != nil {
		if store.IsConflict(err) {
			return httpx.Conflict("You already have a list with that name.").WithCause(err)
		}
		return storeError(err, "List")
	}

	httpx.JSON(w, http.StatusCreated, copied)
	return nil
}

// ownedList loads a list and confirms the caller owns it.
func (s *Server) ownedList(r *http.Request) (*store.List, error) {
	id, err := urlUUID(r, "id")
	if err != nil {
		return nil, err
	}

	list, err := s.store.GetList(r.Context(), id)
	if err != nil {
		return nil, storeError(err, "List")
	}

	user := auth.MustFromContext(r.Context())
	if list.OwnerID != user.ID {
		return nil, httpx.NotFound("List was not found.")
	}
	return list, nil
}

func (s *Server) handleUpdateList(w http.ResponseWriter, r *http.Request) error {
	list, err := s.ownedList(r)
	if err != nil {
		return err
	}

	var req listPatchRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}

	invalid := func(field, message string) error {
		return httpx.Validation("The list could not be saved.").
			WithDetails(validationErrors{field: message})
	}

	// A name may be changed but never cleared.
	if req.Name.Set {
		if req.Name.Value == nil {
			return invalid("name", nameProblem(""))
		}
		if msg := nameProblem(*req.Name.Value); msg != "" {
			return invalid("name", msg)
		}
	}
	if req.Description.Set && req.Description.Value != nil &&
		utf8.RuneCountInString(*req.Description.Value) > maxDescriptionLen {
		return invalid("description", "Description is too long.")
	}

	// Name needs no Set guard: absent leaves Value nil, and null was rejected.
	update := store.ListUpdate{Name: req.Name.Value, IsPublic: req.IsPublic.ptr()}
	if req.Description.Set {
		// SetDescription makes the store apply a nil (clear) rather than skip it.
		update.Description = req.Description.Value
		update.SetDescription = true
	}

	updated, err := s.store.UpdateList(r.Context(), list.ID, update)
	if err != nil {
		if store.IsConflict(err) {
			return httpx.Conflict("You already have a list with that name.").WithCause(err)
		}
		return storeError(err, "List")
	}

	httpx.JSON(w, http.StatusOK, updated)
	return nil
}

func (s *Server) handleDeleteList(w http.ResponseWriter, r *http.Request) error {
	list, err := s.ownedList(r)
	if err != nil {
		return err
	}
	// The default list is where one-tap saves go.
	if list.IsDefault {
		return httpx.Forbidden("Your default list cannot be deleted.")
	}
	if err := s.store.DeleteList(r.Context(), list.ID); err != nil {
		return storeError(err, "List")
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) handleAddSongToList(w http.ResponseWriter, r *http.Request) error {
	list, err := s.ownedList(r)
	if err != nil {
		return err
	}
	songID, err := s.songID(r, "songID")
	if err != nil {
		return err
	}

	if err := s.store.AddSongToList(r.Context(), list.ID, songID); err != nil {
		return storeError(err, "Song")
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) handleRemoveSongFromList(w http.ResponseWriter, r *http.Request) error {
	list, err := s.ownedList(r)
	if err != nil {
		return err
	}
	songID, err := s.songID(r, "songID")
	if err != nil {
		return err
	}

	if err := s.store.RemoveSongFromList(r.Context(), list.ID, songID); err != nil {
		return storeError(err, "Song in this list")
	}
	httpx.NoContent(w)
	return nil
}

func (s *Server) handleReorderList(w http.ResponseWriter, r *http.Request) error {
	list, err := s.ownedList(r)
	if err != nil {
		return err
	}

	var req struct {
		SongIDs []uuid.UUID `json:"song_ids"`
	}
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}
	if len(req.SongIDs) == 0 {
		return httpx.Validation("The list could not be reordered.").
			WithDetails(validationErrors{"song_ids": "At least one song is required."})
	}
	// Capped: the whole payload goes to PostgreSQL as one array in a transaction.
	if len(req.SongIDs) > maxReorderRefs {
		return httpx.Validation("The list could not be reordered.").
			WithDetails(validationErrors{"song_ids": "Too many songs in one request."})
	}
	// The store matches ids as a set and would report a duplicate as a 404.
	seen := make(map[uuid.UUID]struct{}, len(req.SongIDs))
	for _, songID := range req.SongIDs {
		if _, duplicate := seen[songID]; duplicate {
			return httpx.Validation("The list could not be reordered.").
				WithDetails(validationErrors{"song_ids": "Each song may appear only once."})
		}
		seen[songID] = struct{}{}
	}

	if err := s.store.ReorderList(r.Context(), list.ID, req.SongIDs); err != nil {
		return storeError(err, "Song in this list")
	}

	// The row as loaded, without songs: this runs on every drop, and a reorder
	// changes nothing in the row itself.
	httpx.JSON(w, http.StatusOK, list)
	return nil
}

// handleListsContainingSong reports which of the caller's lists hold a song, so
// the UI can render toggle state in one request instead of one per list.
func (s *Server) handleListsContainingSong(w http.ResponseWriter, r *http.Request) error {
	// By ref: every route naming a song takes a slug or a uuid.
	songID, err := s.songID(r, "id")
	if err != nil {
		return err
	}
	user := auth.MustFromContext(r.Context())

	ids, err := s.store.ListIDsContainingSong(r.Context(), user.ID, songID)
	if err != nil {
		return storeError(err, "Lists")
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"list_ids": ids})
	return nil
}
