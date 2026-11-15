// Package api holds the HTTP surface: routing, request decoding, authorization
// checks, and the mapping from store errors onto status codes.
package api

import (
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/google/uuid"

	"github.com/christos/lyrics/backend/internal/auth"
	"github.com/christos/lyrics/backend/internal/config"
	"github.com/christos/lyrics/backend/internal/httpx"
	"github.com/christos/lyrics/backend/internal/prelude"
	"github.com/christos/lyrics/backend/internal/store"
)

// Server carries the dependencies shared by every handler.
type Server struct {
	cfg     config.Config
	store   *store.Store
	prelude prelude.Client
	authn   *auth.Authenticator

	// registerLimiter throttles registration, keyed on the caller's address.
	registerLimiter *rateLimiter
	// avatarLimiter throttles picture uploads, keyed on the user's id, which
	// the token proves and a NAT does not share.
	avatarLimiter *rateLimiter
}

// NewServer wires the HTTP layer.
func NewServer(cfg config.Config, st *store.Store, pc prelude.Client, authn *auth.Authenticator) *Server {
	return &Server{
		cfg:     cfg,
		store:   st,
		prelude: pc,
		authn:   authn,
		// Registration costs two upstream calls and creates permanent state.
		registerLimiter: newRateLimiter(5, time.Minute),
		// An upload is the costliest request in the API (decode + re-encode).
		avatarLimiter: newRateLimiter(10, time.Minute),
	}
}

// Routes builds the router. Every route sits behind Optional auth; stricter
// middlewares layer on top.
func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()

	r.Use(httpx.RequestID)
	r.Use(httpx.RequestLogger)
	r.Use(httpx.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", httpx.Handler(s.handleHealth))

		r.Group(func(r chi.Router) {
			r.Use(s.authn.Optional)

			r.Get("/songs", httpx.Handler(s.handleListSongs))
			r.Get("/songs/{id}", httpx.Handler(s.handleGetSong))
			r.Get("/people", httpx.Handler(s.handleListPeople))
			r.Get("/people/{id}", httpx.Handler(s.handleGetPerson))
			r.Get("/genres", httpx.Handler(s.handleListGenres))
			r.Get("/lists/{id}", httpx.Handler(s.handleGetList))
			// Public: an <img> carries no Authorization header.
			r.Get("/users/{id}/avatar", httpx.Handler(s.handleGetUserAvatar))

			r.Post("/auth/register", httpx.Handler(s.handleRegister))

			// Everything an unverified account may do. Every other authenticated
			// route goes behind RequireVerifiedEmail.
			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required)

				r.Get("/me", httpx.Handler(s.handleGetMe))
				r.Post("/auth/verify-email", httpx.Handler(s.handleVerifyEmail))
			})

			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required, auth.RequireVerifiedEmail)

				r.Patch("/me", httpx.Handler(s.handleUpdateMe))
				// Raw image bytes, not a field on the tri-state PATCH.
				r.Post("/me/avatar", httpx.Handler(s.handleUploadAvatar))
				r.Delete("/me/avatar", httpx.Handler(s.handleDeleteAvatar))

				r.Get("/lists", httpx.Handler(s.handleListLists))
				r.Post("/lists", httpx.Handler(s.handleCreateList))
				// Copying reads someone else's list and writes the caller's own,
				// so the source's visibility is checked in the handler.
				r.Post("/lists/{id}/copy", httpx.Handler(s.handleCopyList))
				r.Patch("/lists/{id}", httpx.Handler(s.handleUpdateList))
				r.Delete("/lists/{id}", httpx.Handler(s.handleDeleteList))
				r.Put("/lists/{id}/songs/{songID}", httpx.Handler(s.handleAddSongToList))
				r.Delete("/lists/{id}/songs/{songID}", httpx.Handler(s.handleRemoveSongFromList))
				r.Post("/lists/{id}/reorder", httpx.Handler(s.handleReorderList))
				r.Get("/songs/{id}/lists", httpx.Handler(s.handleListsContainingSong))
			})

			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required, auth.RequireVerifiedEmail, auth.RequireRole(store.RoleContributor))

				r.Post("/songs", httpx.Handler(s.handleCreateSong))
				// Ownership is enforced inside the handler: a contributor may
				// edit only their own songs, which the router cannot express.
				r.Patch("/songs/{id}", httpx.Handler(s.handleUpdateSong))
				r.Post("/people", httpx.Handler(s.handleCreatePerson))
				r.Post("/genres", httpx.Handler(s.handleCreateGenre))
			})

			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required, auth.RequireVerifiedEmail, auth.RequireRole(store.RoleAdmin))

				r.Delete("/songs/{id}", httpx.Handler(s.handleDeleteSong))
				r.Patch("/people/{id}", httpx.Handler(s.handleUpdatePerson))
				r.Delete("/people/{id}", httpx.Handler(s.handleDeletePerson))
				r.Patch("/genres/{id}", httpx.Handler(s.handleUpdateGenre))
				r.Delete("/genres/{id}", httpx.Handler(s.handleDeleteGenre))
				r.Get("/admin/users", httpx.Handler(s.handleListUsers))
				r.Patch("/admin/users/{id}/role", httpx.Handler(s.handleSetUserRole))
				r.Delete("/admin/users/{id}", httpx.Handler(s.handleDeleteUser))
			})
		})
	})

	r.NotFound(httpx.Handler(func(http.ResponseWriter, *http.Request) error {
		return httpx.NoRoute("No such endpoint.")
	}))
	r.MethodNotAllowed(httpx.Handler(func(http.ResponseWriter, *http.Request) error {
		return httpx.BadRequest("Method not allowed for this endpoint.")
	}))

	return r
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) error {
	if err := s.store.Ping(r.Context()); err != nil {
		return httpx.Internal("Database is unreachable.").WithCause(err)
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	return nil
}

// urlUUID reads the {id} path parameter as a UUID.
func urlUUID(r *http.Request) (uuid.UUID, error) {
	raw := chi.URLParam(r, "id")
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, httpx.BadRequest("%q is not a valid identifier.", raw)
	}
	return id, nil
}

// songRef loads the song a {id} path segment names, by slug or by UUID. UUID
// first is safe: the slug trigger never mints a UUID-shaped slug. Unknown is
// 404, never 400. See CLAUDE.md "Song addresses".
func (s *Server) songRef(r *http.Request, name string) (*store.Song, error) {
	raw := chi.URLParam(r, name)
	if id, err := uuid.Parse(raw); err == nil {
		song, err := s.store.GetSong(r.Context(), id)
		return song, storeError(err, "Song")
	}
	song, err := s.store.GetSongBySlug(r.Context(), raw)
	return song, storeError(err, "Song")
}

// songID resolves a {id} segment to the song's id only, without loading the
// song. A well-formed UUID is returned unlooked-up, so callers keep their own
// not-found behavior (GET /songs/{unknown-uuid}/lists stays an empty list).
func (s *Server) songID(r *http.Request, name string) (uuid.UUID, error) {
	raw := chi.URLParam(r, name)
	if id, err := uuid.Parse(raw); err == nil {
		return id, nil
	}
	id, err := s.store.SongIDBySlug(r.Context(), raw)
	if err != nil {
		return uuid.Nil, storeError(err, "Song")
	}
	return id, nil
}

// queryUUID reads an optional UUID query parameter from an already-parsed query.
func queryUUID(q url.Values, name string) (*uuid.UUID, error) {
	raw := q.Get(name)
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, httpx.BadRequest("Query parameter %q must be a valid identifier.", name)
	}
	return &id, nil
}

// storeError maps a data layer error onto an HTTP response.
//
// An *httpx.APIError is checked first: it unwraps to its cause, so one carrying
// a store error would otherwise have the handler's chosen response replaced.
func storeError(err error, subject string) error {
	var apiErr *httpx.APIError
	switch {
	case err == nil:
		return nil
	case errors.As(err, &apiErr):
		return err
	case store.IsNotFound(err):
		return httpx.NotFound("%s was not found.", subject).WithCause(err)
	case store.IsConflict(err):
		return httpx.Conflict("%s already exists.", subject).WithCause(err)
	case store.IsInUse(err):
		return httpx.Conflict("%s is still referenced by other records.", subject).WithCause(err)
	case store.IsInvalid(err):
		// The store's message names internal rules, so it stays on the cause.
		return httpx.Validation("%s is not valid.", subject).WithCause(err)
	default:
		return httpx.Internal("Unable to complete the request.").WithCause(err)
	}
}
