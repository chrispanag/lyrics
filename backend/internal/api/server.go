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
	// Unauthenticated traffic carries no identity to key on, so the address is
	// all there is — with the caveats clientIP documents.
	registerLimiter *rateLimiter
	// avatarLimiter throttles picture uploads, keyed on the user's id.
	//
	// The route is authenticated, so the id is available and is the better key
	// in both directions: it is proven by the token, where an address is
	// whatever the network says — an office behind one NAT shares a bucket, and
	// the address is also the part of a request a determined caller can vary,
	// which buys a fresh bucket per attempt. Keying on the account being
	// charged for the work is exact.
	avatarLimiter *rateLimiter
}

// NewServer wires the HTTP layer.
func NewServer(cfg config.Config, st *store.Store, pc prelude.Client, authn *auth.Authenticator) *Server {
	return &Server{
		cfg:     cfg,
		store:   st,
		prelude: pc,
		authn:   authn,
		// Registration costs two upstream calls and creates permanent state: 5
		// attempts per IP per minute is far above honest use and far below
		// useful abuse.
		registerLimiter: newRateLimiter(5, time.Minute),
		// An upload decodes an image and re-encodes a JPEG, which is the most
		// CPU and allocation any single request in this API asks for, and a
		// signed-in account can ask for it in a loop. 10 per minute leaves room
		// for someone re-cropping a photo they are not happy with — honest use
		// is a handful of pictures in the lifetime of an account — while
		// bounding one account to ten decodes a minute, which is no use to
		// anybody trying to spend the server's CPU. Spreading the attempt over
		// more accounts runs into registerLimiter instead.
		avatarLimiter: newRateLimiter(10, time.Minute),
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
			// Public, and it has to be: an <img> is not fetched by the API
			// client and carries no Authorization header, so a route behind
			// authentication would answer as a guest for the picture's own
			// owner. Avatars are therefore public content keyed by an
			// unguessable identifier, and a missing picture and an unknown user
			// are the same 404.
			r.Get("/users/{id}/avatar", httpx.Handler(s.handleGetUserAvatar))

			// --- Registration -------------------------------------------------
			r.Post("/auth/register", httpx.Handler(s.handleRegister))

			// --- Signed in, address not yet confirmed -------------------------
			//
			// Everything an unverified account may do. The list is short on
			// purpose: it is exactly what the verification screen needs — who
			// am I, and record the challenge I just completed — and every other
			// authenticated route sits behind RequireVerifiedEmail below.
			// Sending and checking the code never reaches this API: that is
			// between the browser and Prelude.
			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required)

				r.Get("/me", httpx.Handler(s.handleGetMe))
				r.Post("/auth/verify-email", httpx.Handler(s.handleVerifyEmail))
			})

			// --- Authenticated ------------------------------------------------
			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required, auth.RequireVerifiedEmail)

				r.Patch("/me", httpx.Handler(s.handleUpdateMe))
				// Raw image bytes rather than a field on the PATCH above: that
				// one is tri-state JSON, and mixing a body it cannot express
				// into it would cost both of them their shape.
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

			// --- Contributor and above ----------------------------------------
			r.Group(func(r chi.Router) {
				r.Use(s.authn.Required, auth.RequireVerifiedEmail, auth.RequireRole(store.RoleContributor))

				r.Post("/songs", httpx.Handler(s.handleCreateSong))
				// Ownership is enforced inside the handler: a contributor may
				// edit only their own songs, which the router cannot express.
				r.Patch("/songs/{id}", httpx.Handler(s.handleUpdateSong))
				r.Post("/people", httpx.Handler(s.handleCreatePerson))
				r.Post("/genres", httpx.Handler(s.handleCreateGenre))
			})

			// --- Admin only ---------------------------------------------------
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

// songRef loads the song a {id} path segment names, by slug or by UUID.
//
// A song is addressed by its slug now, and every link written before this
// existed addresses it by its id — so both have to resolve, forever. The UUID
// parse decides which lookup to make, and it is safe as the first question
// because migration 000010's trigger refuses to mint a UUID-shaped slug: there
// is no song whose address a well-formed id could shadow.
//
// Unlike urlUUID this cannot answer 400. Once a slug is a legal address, a path
// segment that resolves to nothing means "no such song" rather than "that is not
// an identifier", and the caller has no way to tell a typo'd slug from a deleted
// one anyway.
func (s *Server) songRef(r *http.Request, name string) (*store.Song, error) {
	raw := chi.URLParam(r, name)
	if id, err := uuid.Parse(raw); err == nil {
		song, err := s.store.GetSong(r.Context(), id)
		return song, storeError(err, "Song")
	}
	song, err := s.store.GetSongBySlug(r.Context(), raw)
	return song, storeError(err, "Song")
}

// songID is the same resolution for the handlers that want the identity behind
// an address rather than the song at it.
//
// Every route whose path names a song has to take both forms, but most of them
// only need the id: handleDeleteSong, handleListsContainingSong, and the two
// ways a song moves in and out of a list. Reaching those through songRef costs
// the whole row plus the four queries attachRelations runs, all to read `.ID` —
// so they come through here instead, and a UUID segment costs no query at all.
//
// A well-formed UUID is returned unlooked-up on purpose, which is what keeps
// these handlers answering exactly as they did before slugs existed: their own
// store calls already map a missing row onto ErrNotFound, and asking first would
// turn `GET /songs/{unknown-uuid}/lists` from the empty list it has always
// answered into a 404.
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
