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

// handleGetList serves a single list with its songs.
//
// This is the one read endpoint with a visibility rule: lists are private by
// default, so a guest or another user may read it only once it is marked public.
func (s *Server) handleGetList(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}

	// The visibility check runs against the list row alone, before its songs are
	// loaded. Fetching first would make a guest walking identifiers materialize
	// every private list's full contents — lyrics bodies included — only to be
	// told 404.
	list, err := s.store.GetList(r.Context(), id)
	if err != nil {
		return storeError(err, "List")
	}

	user := auth.FromContext(r.Context())
	isOwner := user != nil && user.ID == list.OwnerID
	if !list.IsPublic && !isOwner {
		// 404 rather than 403: confirming that a private list exists would leak
		// its existence to anyone guessing identifiers.
		return httpx.NotFound("List was not found.")
	}

	full, err := s.store.GetListWithSongs(r.Context(), id)
	if err != nil {
		return storeError(err, "List")
	}

	httpx.JSON(w, http.StatusOK, full)
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

	// One envelope for every field problem on this endpoint, so the wording
	// lives in one place rather than once per field.
	invalid := func(field, message string) error {
		return httpx.Validation("The list could not be saved.").
			WithDetails(validationErrors{field: message})
	}

	// A name may be changed but never cleared, so an explicit null is a
	// validation error rather than a silent no-op.
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

	// Name needs no Set guard: optionalString leaves Value nil when the field is
	// absent, and the check above already rejected the explicit-null case.
	update := store.ListUpdate{Name: req.Name.Value, IsPublic: req.IsPublic.ptr()}
	if req.Description.Set {
		// Cleared descriptions are stored as NULL; SetDescription tells the
		// store to apply the change rather than skip a nil pointer.
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
	// The default list is the destination for one-tap saves; removing it would
	// leave the UI with nowhere to put a song.
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
	songID, err := urlUUID(r, "songID")
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
	songID, err := urlUUID(r, "songID")
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
	// ReorderList issues one UPDATE per id inside a single transaction, so an
	// uncapped payload holds a pooled connection and an open transaction for as
	// long as the write timeout allows.
	if len(req.SongIDs) > maxReorderRefs {
		return httpx.Validation("The list could not be reordered.").
			WithDetails(validationErrors{"song_ids": "Too many songs in one request."})
	}

	if err := s.store.ReorderList(r.Context(), list.ID, req.SongIDs); err != nil {
		return storeError(err, "Song in this list")
	}

	updated, err := s.store.GetListWithSongs(r.Context(), list.ID)
	if err != nil {
		return storeError(err, "List")
	}
	httpx.JSON(w, http.StatusOK, updated)
	return nil
}

// handleListsContainingSong reports which of the caller's lists hold a song, so
// the UI can render toggle state in one request instead of one per list.
func (s *Server) handleListsContainingSong(w http.ResponseWriter, r *http.Request) error {
	songID, err := urlUUID(r, "id")
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
