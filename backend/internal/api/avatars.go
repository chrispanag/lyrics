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

// avatarCacheControl is how long a browser may reuse a picture before asking
// again. It is a year and immutable because the client appends the picture's
// version to the URL: a replacement is a different address, so there is nothing
// to revalidate, and every conditional request an hour's freshness would have
// bought is a round trip for an answer already known.
const avatarCacheControl = "public, max-age=31536000, immutable"

func (s *Server) handleUploadAvatar(w http.ResponseWriter, r *http.Request) error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, imaging.MaxBytes))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			// Answered the same way the decoder answers an image that is too
			// large, so a form has one message about size rather than two that
			// depend on how far over the limit the file was.
			return avatarError(imaging.ErrTooLarge)
		}
		return httpx.BadRequest("That picture could not be read.").WithCause(err)
	}

	// The request's own Content-Type is not consulted: the bytes are decoded to
	// find out what they are, and a declared type is only ever the client's
	// word for it. What comes back is the type to store, from the code that
	// chose the encoding.
	normalized, contentType, err := imaging.Normalize(body)
	if err != nil {
		return avatarError(err)
	}

	user := auth.MustFromContext(r.Context())
	updated, err := s.store.SetAvatar(r.Context(), user.ID, contentType, normalized)
	if err != nil {
		return storeError(err, "Account")
	}

	// Responds with the updated user, like PATCH /me: the client hands it
	// straight to the auth context instead of following up with a GET /me for a
	// record it is already holding.
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
	id, err := urlUUID(r, "id")
	if err != nil {
		return err
	}

	avatar, err := s.store.Avatar(r.Context(), id)
	if err != nil {
		// "No such user" and "that user has no picture" are deliberately the
		// same answer, so this route cannot be used to find out which
		// identifiers belong to accounts.
		return storeError(err, "Picture")
	}

	// The picture's version, which is also what the client puts in the URL.
	w.Header().Set("ETag", strconv.Quote(strconv.FormatInt(avatar.UpdatedAt.UnixNano(), 10)))
	w.Header().Set("Cache-Control", avatarCacheControl)
	w.Header().Set("Content-Type", avatar.ContentType)

	// ServeContent answers the conditional request rather than this handler
	// comparing the tag itself. A browser echoes an ETag verbatim, so a string
	// comparison covers the browser — but `Cache-Control: public` invites a
	// shared cache in front of this route, and those revalidate with a *list*
	// of tags, or a weak one. Either misses an exact comparison and is answered
	// with the whole image, silently. Content-Length and Range come with it.
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
