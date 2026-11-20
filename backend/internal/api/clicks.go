package api

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/store"
)

// clickRateLimit is how many openings one caller may record per minute.
// Signed-in callers are keyed on their account, so a shared address does not
// spend a household's budget; guests are keyed on the address.
const clickRateLimit = 60

type clickRequest struct {
	// VisitorID identifies a signed-out browser. Ignored when a session is
	// present: the account is the actor, and a client-chosen id must not be
	// able to split one person's clicks across many tallies.
	VisitorID string `json:"visitor_id"`
}

func (s *Server) handleRecordSongClick(w http.ResponseWriter, r *http.Request) error {
	user := auth.FromContext(r.Context())

	key := clientIP(r, s.cfg.ClientIPHeader)
	if user != nil {
		key = user.ID.String()
	}
	if !s.clickLimiter.allow(key) {
		return httpx.RateLimited("Too many song opens. Please try again shortly.")
	}

	songID, err := s.songID(r, "id")
	if err != nil {
		return err
	}

	var req clickRequest
	if err := httpx.DecodeJSON(w, r, &req); err != nil {
		return err
	}

	actor, authenticated, err := clickActor(user, req.VisitorID)
	if err != nil {
		return err
	}

	if _, err := s.store.RecordSongClick(r.Context(), songID, actor, authenticated); err != nil {
		return storeError(err, "Song")
	}
	// The tally after this call, so the page can show it without a second read.
	// A repeat inside the visit window comes back unchanged.
	popularity, err := s.store.SongPopularity(r.Context(), songID)
	if err != nil {
		return storeError(err, "Song")
	}
	httpx.JSON(w, http.StatusOK, popularity)
	return nil
}

// clickActor decides who an opening counts as. A session wins over any
// visitor id the body carries.
func clickActor(user *store.User, visitorID string) (string, bool, error) {
	if user != nil {
		return store.UserClickActor(user.ID), true, nil
	}

	visitor, err := uuid.Parse(strings.TrimSpace(visitorID))
	if err != nil || visitor == uuid.Nil {
		return "", false, httpx.BadRequest("Visitor id must be a UUID.")
	}
	return store.AnonymousClickActor(visitor), false, nil
}
