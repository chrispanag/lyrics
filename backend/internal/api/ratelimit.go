package api

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// rateLimiter is a fixed-window per-key counter. It is per-process, so the
// effective limit multiplies with replicas.
type rateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	buckets map[string]*bucket
	// lastSweep drives eviction, bounding map growth.
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

// clientIP identifies the caller for rate limiting. `header` is the one header
// trusted to carry the address (see config.ClientIPHeader), or "" for the peer.
// Anything unparseable falls back to the peer, never to a client-chosen key.
func clientIP(r *http.Request, header string) string {
	if header != "" {
		// Parsed, so a comma-joined list is refused rather than becoming a key.
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
