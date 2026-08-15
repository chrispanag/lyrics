package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

type contextKey string

const requestIDKey contextKey = "request_id"

// RequestIDFrom returns the correlation ID assigned to a request, if any.
func RequestIDFrom(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// RequestID assigns each request a correlation ID, honoring an inbound
// X-Request-Id so a trace survives across a proxy, and echoes it back.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" || len(id) > 64 {
			buf := make([]byte, 8)
			// crypto/rand.Read never returns an error as of Go 1.24.
			_, _ = rand.Read(buf)
			id = hex.EncodeToString(buf)
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

// RequestLogger emits one structured line per completed request.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		next.ServeHTTP(ww, r)

		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"bytes", ww.BytesWritten(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", RequestIDFrom(r.Context()),
			"remote_addr", r.RemoteAddr,
		)
	})
}

// Recoverer converts a panic into a 500 so one bad request cannot take down the
// process. The stack is logged; the client is told nothing beyond "internal error".
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			rec := recover()
			if rec == nil {
				return
			}
			// A dropped client connection surfaces as a panic with this value and
			// is not an application fault; there is also nobody left to respond to.
			if rec == http.ErrAbortHandler {
				panic(rec)
			}

			slog.Error("panic recovered",
				"panic", rec,
				"method", r.Method,
				"path", r.URL.Path,
				"request_id", RequestIDFrom(r.Context()),
				"stack", string(debug.Stack()),
			)
			JSON(w, http.StatusInternalServerError, errorEnvelope{
				Error: Internal("An unexpected error occurred."),
			})
		}()

		next.ServeHTTP(w, r)
	})
}
