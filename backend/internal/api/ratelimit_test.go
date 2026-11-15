package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Spelled as .do/app.yaml ships it, not canonicalized.
const clientIPHeader = "DO-Connecting-IP"

// Pins both silent failures: one shared bucket behind a proxy, and a
// client-forgeable header buying a fresh bucket per request.
func TestClientIP(t *testing.T) {
	for _, tc := range []struct {
		name   string
		header string // the header clientIP is configured to trust
		set    map[string]string
		want   string
	}{
		{
			name: "the peer address when no header is trusted",
			want: "192.0.2.10",
		},
		{
			name: "an untrusted header is ignored even when present",
			set:  map[string]string{clientIPHeader: "203.0.113.7", "X-Forwarded-For": "203.0.113.8"},
			want: "192.0.2.10",
		},
		{
			name:   "the trusted header when it carries an address",
			header: clientIPHeader,
			set:    map[string]string{clientIPHeader: "203.0.113.7"},
			want:   "203.0.113.7",
		},
		{
			name:   "only the named header, not whichever one is populated",
			header: clientIPHeader,
			set:    map[string]string{"X-Forwarded-For": "203.0.113.8"},
			want:   "192.0.2.10",
		},
		{
			name:   "the peer address when the trusted header is absent",
			header: clientIPHeader,
			want:   "192.0.2.10",
		},
		{
			// Falling back is the safe direction.
			name:   "the peer address when the trusted header is not an address",
			header: clientIPHeader,
			set:    map[string]string{clientIPHeader: "not-an-ip"},
			want:   "192.0.2.10",
		},
		{
			// A list is not an address, so its client-controlled first entry is
			// never used.
			name:   "the peer address for a comma-joined list",
			header: clientIPHeader,
			set:    map[string]string{clientIPHeader: "203.0.113.7, 198.51.100.1"},
			want:   "192.0.2.10",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/register", nil)
			r.RemoteAddr = "192.0.2.10:54321"
			for k, v := range tc.set {
				r.Header.Set(k, v)
			}

			if got := clientIP(r, tc.header); got != tc.want {
				t.Errorf("clientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

// Two callers behind one proxy must land in different buckets.
func TestRateLimitSeparatesCallersBehindAProxy(t *testing.T) {
	limiter := newRateLimiter(2, time.Minute)

	attempt := func(callerIP string) bool {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/register", nil)
		// One proxy, one peer address.
		r.RemoteAddr = "10.0.0.1:443"
		r.Header.Set(clientIPHeader, callerIP)
		return limiter.allow(clientIP(r, clientIPHeader))
	}

	for i := range 2 {
		if !attempt("203.0.113.7") {
			t.Fatalf("attempt %d from the first caller was refused within the limit", i+1)
		}
	}
	if attempt("203.0.113.7") {
		t.Error("a third attempt from the same caller was allowed past a limit of 2")
	}
	if !attempt("198.51.100.1") {
		t.Error("a different caller behind the same proxy was refused")
	}
}
