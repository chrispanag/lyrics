package api

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
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
// `header` is the one header trusted to carry the caller's address, or "" to use
// the peer address. No header is consulted by default and none is guessed at:
// anything a client can set is a bypass rather than an improvement, since the
// limit is per key and a forged value per request buys a fresh bucket each time.
// Naming it in configuration is what makes trusting it a deployment's decision,
// taken where it is known that every request arrives through a proxy that
// overwrites it — see config.ClientIPHeader for which header that is here, and
// why it is not X-Forwarded-For.
//
// Behind a proxy with nothing configured, every caller collapses onto the
// proxy's address and shares one bucket. That is the failure this exists to fix,
// and it is also the direction to fail in: a value that is missing, or not an
// address at all, falls back to the peer rather than keying on whatever arrived.
func clientIP(r *http.Request, header string) string {
	if header != "" {
		// Parsed rather than taken verbatim, which also settles the comma-joined
		// list a misconfigured header would carry: it is not an address, so it is
		// refused instead of becoming a key of its own.
		if ip, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get(header))); err == nil {
			return ip.String()
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
