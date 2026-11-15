package api

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/imaging"
)

// avatarCacheControl is short and not immutable: a removal mints no new URL,
// so max-age is the deletion's latency. See CLAUDE.md "Profile pictures".
const avatarCacheControl = "public, max-age=300"

func (s *Server) handleUploadAvatar(w http.ResponseWriter, r *http.Request) error {
	user := auth.MustFromContext(r.Context())

	// Before reading the body. DELETE is deliberately not limited.
	if !s.avatarLimiter.allow(user.ID.String()) {
		return httpx.RateLimited("Too many picture uploads. Please try again shortly.")
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, imaging.MaxBytes))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			// Same answer as the decoder's, so a form has one size message.
			return avatarError(imaging.ErrTooLarge)
		}
		return httpx.BadRequest("That picture could not be read.").WithCause(err)
	}

	// The request's Content-Type is ignored; the type comes from the encoder.
	normalized, contentType, err := imaging.Normalize(body)
	if err != nil {
		return avatarError(err)
	}

	updated, err := s.store.SetAvatar(r.Context(), user.ID, contentType, normalized)
	if err != nil {
		return storeError(err, "Account")
	}

	// Responds with the updated user, like PATCH /me.
	httpx.JSON(w, http.StatusOK, updated)
	return nil
}

func (s *Server) handleDeleteAvatar(w http.ResponseWriter, r *http.Request) error {
	user := auth.MustFromContext(r.Context())

	updated, err := s.store.ClearAvatar(r.Context(), user.ID)
	if err != nil {
		return storeError(err, "Account")
	}
	httpx.JSON(w, http.StatusOK, updated)
	return nil
}

func (s *Server) handleGetUserAvatar(w http.ResponseWriter, r *http.Request) error {
	id, err := urlUUID(r)
	if err != nil {
		return err
	}

	avatar, err := s.store.Avatar(r.Context(), id)
	if err != nil {
		// No user and no picture are the same 404, so ids cannot be probed.
		return storeError(err, "Picture")
	}

	// The picture's version, which is also what the client puts in the URL.
	w.Header().Set("ETag", strconv.Quote(strconv.FormatInt(avatar.UpdatedAt.UnixNano(), 10)))
	w.Header().Set("Cache-Control", avatarCacheControl)
	w.Header().Set("Content-Type", avatar.ContentType)

	// ServeContent, not a string compare: shared caches send ETag lists or weak
	// tags, which an exact comparison silently misses.
	http.ServeContent(w, r, "", avatar.UpdatedAt, bytes.NewReader(avatar.Image))
	return nil
}

// avatarError renders an imaging failure as something a form can show.
func avatarError(err error) error {
	switch {
	case errors.Is(err, imaging.ErrTooLarge):
		return httpx.Validation("That picture is too large.").
			WithDetails(validationErrors{"image": fmt.Sprintf(
				"Use a picture under %d KB, at most %d pixels on each side.",
				imaging.MaxBytes/1024, imaging.MaxDimension)}).
			WithCause(err)
	case errors.Is(err, imaging.ErrUnsupported):
		return httpx.Validation("That file is not a picture we can read.").
			WithDetails(validationErrors{"image": "Choose a JPEG or PNG image."}).
			WithCause(err)
	default:
		return httpx.Internal("That picture could not be processed.").WithCause(err)
	}
}
