package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) error {
	httpx.JSON(w, http.StatusOK, auth.MustFromContext(r.Context()))
	return nil
}

func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		DisplayName optionalString `json:"display_name"`
	}
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}

	user := auth.MustFromContext(r.Context())

	// An omitted field means "unchanged", not "clear it".
	if !req.DisplayName.Set {
		httpx.JSON(w, http.StatusOK, user)
		return nil
	}

	if req.DisplayName.Value != nil && utf8.RuneCountInString(*req.DisplayName.Value) > maxNameLen {
		return httpx.Validation("Your profile could not be saved.").
			WithDetails(validationErrors{"display_name": "Display name is too long."})
	}

	updated, err := s.store.UpdateProfile(r.Context(), user.ID, req.DisplayName.Value)
	if err != nil {
		return storeError(err, "Account")
	}
	httpx.JSON(w, http.StatusOK, updated)
	return nil
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	limit, offset := httpx.Pagination(q)

	filter := store.UserFilter{
		Query:  strings.TrimSpace(q.Get("q")),
		Limit:  limit,
		Offset: offset,
	}
	if raw := strings.TrimSpace(q.Get("role")); raw != "" {
		role := store.Role(strings.ToLower(raw))
		if !role.Valid() {
			return httpx.BadRequest("Role must be user, contributor, or admin.")
		}
		filter.Role = role
	}

	users, total, err := s.store.ListUsers(r.Context(), filter)
	if err != nil {
		return storeError(err, "Users")
	}
	httpx.JSON(w, http.StatusOK, httpx.NewListResponse(users, total, limit, offset))
	return nil
}

func (s *Server) handleSetUserRole(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}

	role := store.Role(strings.ToLower(strings.TrimSpace(req.Role)))
	if !role.Valid() {
		return httpx.Validation("The role could not be changed.").
			WithDetails(validationErrors{"role": "Role must be user, contributor, or admin."})
	}

	target, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		return storeError(err, "User")
	}

	// Refuse the change that would leave nobody able to administer the platform,
	// including an admin demoting themselves.
	if target.Role == store.RoleAdmin && role != store.RoleAdmin {
		if err := s.ensureAnotherAdminRemains(r); err != nil {
			return err
		}
	}

	updated, err := s.store.SetRole(r.Context(), id, role)
	if err != nil {
		return storeError(err, "User")
	}
	httpx.JSON(w, http.StatusOK, updated)
	return nil
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}

	actor := auth.MustFromContext(r.Context())
	if actor.ID == id {
		return httpx.Forbidden("You cannot delete your own account from here.")
	}

	target, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		return storeError(err, "User")
	}
	if target.Role == store.RoleAdmin {
		if err := s.ensureAnotherAdminRemains(r); err != nil {
			return err
		}
	}

	// Only the local record is removed. The Prelude account is deliberately
	// left intact: deleting it is irreversible and belongs in the Prelude
	// dashboard, not behind a list row's delete button.
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		return storeError(err, "User")
	}
	httpx.NoContent(w)
	return nil
}

// ensureAnotherAdminRemains blocks the last admin from being demoted or removed.
func (s *Server) ensureAnotherAdminRemains(r *http.Request) error {
	admins, err := s.store.CountAdmins(r.Context())
	if err != nil {
		return storeError(err, "Users")
	}
	if admins <= 1 {
		return httpx.Conflict(
			"This is the only admin account. Promote another admin first.")
	}
	return nil
}
