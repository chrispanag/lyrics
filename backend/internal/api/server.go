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

	// registerLimiter throttles the one unauthenticated write endpoint.
	registerLimiter *rateLimiter
}

// NewServer wires the HTTP layer.
func NewServer(cfg config.Config, st *store.Store, pc prelude.Client, authn *auth.Authenticator) *Server {
	return &Server{
		cfg:     cfg,
		store:   st,
		prelude: pc,
		authn:   authn,
		// Registration costs two upstream calls and creates permanent state, so
		// it is the one endpoint worth rate limiting: 5 attempts per IP per
		// minute is far above honest use and far below useful abuse.
		registerLimiter: newRateLimiter(5, time.Minute),
	}
}

// Routes builds the router.
//
// Every route sits behind Optional auth, so handlers can always read a
// principal when one exists; the stricter middlewares layer on top. Public read
// endpoints are what make the catalog browsable by guests.
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

			// --- Public reads -------------------------------------------------
			r.Get("/songs", httpx.Handler(s.handleListSongs))
			r.Get("/songs/{id}", httpx.Handler(s.handleGetSong))
			r.Get("/people", httpx.Handler(s.handleListPeople))
			r.Get("/people/{id}", httpx.Handler(s.handleGetPerson))
			r.Get("/genres", httpx.Handler(s.handleListGenres))
			r.Get("/lists/{id}", httpx.Handler(s.handleGetList))

			// --- Registration -------------------------------------------------
			r.Post("/auth/register", httpx.Handler(s.handleRegister))

			// --- Authenticated ------------------------------------------------
			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required)

				r.Get("/me", httpx.Handler(s.handleGetMe))
				r.Patch("/me", httpx.Handler(s.handleUpdateMe))

				r.Get("/lists", httpx.Handler(s.handleListLists))
				r.Post("/lists", httpx.Handler(s.handleCreateList))
				r.Patch("/lists/{id}", httpx.Handler(s.handleUpdateList))
				r.Delete("/lists/{id}", httpx.Handler(s.handleDeleteList))
				r.Put("/lists/{id}/songs/{songID}", httpx.Handler(s.handleAddSongToList))
				r.Delete("/lists/{id}/songs/{songID}", httpx.Handler(s.handleRemoveSongFromList))
				r.Post("/lists/{id}/reorder", httpx.Handler(s.handleReorderList))
				r.Get("/songs/{id}/lists", httpx.Handler(s.handleListsContainingSong))
			})

			// --- Contributor and above ----------------------------------------
			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required, auth.RequireRole(store.RoleContributor))

				r.Post("/songs", httpx.Handler(s.handleCreateSong))
				// Ownership is enforced inside the handler: a contributor may
				// edit only their own songs, which the router cannot express.
				r.Patch("/songs/{id}", httpx.Handler(s.handleUpdateSong))
				r.Post("/people", httpx.Handler(s.handleCreatePerson))
				r.Post("/genres", httpx.Handler(s.handleCreateGenre))
			})

			// --- Admin only ---------------------------------------------------
			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required, auth.RequireRole(store.RoleAdmin))

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
		return httpx.NotFound("No such endpoint.")
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

// urlUUID reads a UUID path parameter.
func urlUUID(r *http.Request, name string) (uuid.UUID, error) {
	raw := chi.URLParam(r, name)
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, httpx.BadRequest("%q is not a valid identifier.", raw)
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
func storeError(err error, subject string) error {
	switch {
	case err == nil:
		return nil
	case store.IsNotFound(err):
		return httpx.NotFound("%s was not found.", subject).WithCause(err)
	case store.IsConflict(err):
		return httpx.Conflict("%s already exists.", subject).WithCause(err)
	case store.IsInUse(err):
		return httpx.Conflict("%s is still referenced by other records.", subject).WithCause(err)
	case store.IsInvalid(err):
		// The store's own message names the internal rule it enforced, so it
		// stays on the cause rather than going to the caller.
		return httpx.Validation("%s is not valid.", subject).WithCause(err)
	default:
		var apiErr *httpx.APIError
		if errors.As(err, &apiErr) {
			return err
		}
		return httpx.Internal("Unable to complete the request.").WithCause(err)
	}
}
