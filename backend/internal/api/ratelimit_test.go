package api

import (
	"net/http/httptest"
	"testing"
	"time"
)

// Spelled as .do/app.yaml ships it, rather than in the canonical form the header
// is stored under. Header.Get canonicalizes the name it is handed, so the two
// meet in the map either way — but the string the deployment actually configures
// is then the one these tests put through clientIP.
const clientIPHeader = "DO-Connecting-IP"

// The limit is per key, so which key a request gets is the whole of whether it
// works. Behind a proxy the peer address is the proxy's and every caller shares
// one bucket; trusting a header a client can set is the opposite failure, where
// a forged value per request buys a fresh bucket each time. Both are silent —
// the endpoint answers normally either way — so both directions are pinned here.
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
			// Nothing may be read from a header that was not configured, however
			// plausible its name: this is the bypass, not the fix.
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
			// X-Forwarded-For stays untrusted even here, because it is not the
			// header that was named. On App Platform it carries the ingress
			// address anyway, which is the peer this would have used regardless.
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
			// Falling back is the safe direction: one shared bucket is stricter
			// than a bucket per unparseable string a caller cares to send.
			name:   "the peer address when the trusted header is not an address",
			header: clientIPHeader,
			set:    map[string]string{clientIPHeader: "not-an-ip"},
			want:   "192.0.2.10",
		},
		{
			// What a header set to X-Forwarded-For would actually carry. The list
			// is not an address, so it is refused rather than keyed on — and the
			// first entry, the one a client controls, is never reached.
			name:   "the peer address for a comma-joined list",
			header: clientIPHeader,
			set:    map[string]string{clientIPHeader: "203.0.113.7, 198.51.100.1"},
			want:   "192.0.2.10",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/api/v1/auth/register", nil)
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

// The point of reading the header at all: two callers behind one proxy have to
// land in different buckets. Keyed on the peer address they do not, and the
// sixth honest registration anywhere is refused because of the five before it.
func TestRateLimitSeparatesCallersBehindAProxy(t *testing.T) {
	limiter := newRateLimiter(2, time.Minute)

	attempt := func(callerIP string) bool {
		r := httptest.NewRequest("POST", "/api/v1/auth/register", nil)
		// One proxy, one peer address, as App Platform's ingress presents it.
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
	// The one that used to fail: a different caller, spending none of the budget
	// the first one exhausted.
	if !attempt("198.51.100.1") {
		t.Error("a different caller behind the same proxy was refused")
	}
}
