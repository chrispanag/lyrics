package api

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// rateLimiter is a fixed-window per-key counter.
//
// In-memory and therefore per-process: with more than one API replica the
// effective limit multiplies by the replica count. That is acceptable for the
// single endpoint using it — the goal is to blunt scripted abuse of
// registration, not to enforce an exact quota — but a shared store would be
// needed before relying on it for anything stricter.
type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]*bucket
	// lastSweep bounds map growth: without eviction, every distinct client IP
	// would be retained for the process lifetime.
	lastSweep time.Time
}

type bucket struct {
	count       int
	windowStart time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		limit:     limit,
		window:    window,
		buckets:   make(map[string]*bucket),
		lastSweep: time.Now(),
	}
}

// allow records an attempt and reports whether it is within the limit.
func (rl *rateLimiter) allow(key string) bool {
	now := time.Now()

	rl.mu.Lock()
	defer rl.mu.Unlock()

	if now.Sub(rl.lastSweep) > rl.window {
		for k, b := range rl.buckets {
			if now.Sub(b.windowStart) > rl.window {
				delete(rl.buckets, k)
			}
		}
		rl.lastSweep = now
	}

	b, ok := rl.buckets[key]
	if !ok || now.Sub(b.windowStart) > rl.window {
		rl.buckets[key] = &bucket{count: 1, windowStart: now}
		return true
	}

	b.count++
	return b.count <= rl.limit
}

// clientIP identifies the caller for rate limiting purposes.
//
// The key is the direct peer address only. X-Forwarded-For is deliberately not
// consulted: the header is client-supplied, so trusting it would let anyone
// bypass the limit by forging a new value per request. Behind a known proxy
// every caller instead collapses onto the proxy's address, so this must be
// replaced with that proxy's verified client address before deploying there.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
