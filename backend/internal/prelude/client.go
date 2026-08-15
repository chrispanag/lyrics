// Package prelude is a minimal client for the Prelude Auth Management API.
//
// It exists because the official Go SDK (github.com/prelude-so/go-sdk) covers
// only the verification and messaging products — it has no session/auth
// namespace — while user creation is Management-API-only: the browser SDK can
// log a user in but cannot sign one up. Registration therefore has to happen
// server-side, with the Management API key that must never reach a browser.
package prelude

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Sentinel errors the registration flow branches on.
var (
	// ErrDuplicateIdentifier means the email is already registered.
	ErrDuplicateIdentifier = errors.New("identifier already in use")
	// ErrWeakPassword means the password failed the app's compliancy rules.
	ErrWeakPassword = errors.New("password does not meet requirements")
	// ErrUpstream is any other failure reaching or satisfying Prelude.
	ErrUpstream = errors.New("prelude api error")
)

// Client talks to the Prelude Management API.
type Client interface {
	CreateUser(ctx context.Context, email string, profile *Profile) (userID string, err error)
	SetPassword(ctx context.Context, userID, password string) error
	DeleteUser(ctx context.Context, userID string) error
}

// Profile is the optional name information attached to a Prelude user.
type Profile struct {
	FirstName string `json:"first_name,omitempty"`
	LastName  string `json:"last_name,omitempty"`
}

// HTTPClient is the live implementation.
type HTTPClient struct {
	baseURL string
	appID   string
	apiKey  string
	http    *http.Client
}

// New builds a client against the given Management API base URL.
func New(baseURL, appID, apiKey string) *HTTPClient {
	return &HTTPClient{
		baseURL: baseURL,
		appID:   appID,
		apiKey:  apiKey,
		http: &http.Client{
			// Registration blocks a user-facing request, so this must fail fast
			// rather than hold the handler open for the default (infinite) wait.
			Timeout: 10 * time.Second,
		},
	}
}

type identifier struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type createUserRequest struct {
	Identifiers []identifier `json:"identifiers"`
	Profile     *Profile     `json:"profile,omitempty"`
}

type createUserResponse struct {
	ID string `json:"id"`
}

// apiError is Prelude's error body. The field names are best-effort: the
// documented responses vary by endpoint, so the code falls back to the HTTP
// status when nothing parses.
type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail"`
}

// CreateUser registers an email identifier and returns the `usr_...` identifier.
func (c *HTTPClient) CreateUser(ctx context.Context, email string, profile *Profile) (string, error) {
	body := createUserRequest{
		Identifiers: []identifier{{Type: "email_address", Value: email}},
		Profile:     profile,
	}

	var out createUserResponse
	err := c.do(ctx, http.MethodPost,
		fmt.Sprintf("/v2/session/apps/%s/users", url.PathEscape(c.appID)), body, &out)
	if err != nil {
		return "", err
	}
	if out.ID == "" {
		return "", fmt.Errorf("%w: create user returned no id", ErrUpstream)
	}
	return out.ID, nil
}

// SetPassword sets the password for an existing user.
func (c *HTTPClient) SetPassword(ctx context.Context, userID, password string) error {
	body := struct {
		Password string `json:"password"`
	}{Password: password}

	return c.do(ctx, http.MethodPut,
		fmt.Sprintf("/v2/session/apps/%s/users/%s/password",
			url.PathEscape(c.appID), url.PathEscape(userID)), body, nil)
}

// DeleteUser removes a user. Used to compensate for a half-finished
// registration, so the caller can retry with the same email.
func (c *HTTPClient) DeleteUser(ctx context.Context, userID string) error {
	return c.do(ctx, http.MethodDelete,
		fmt.Sprintf("/v2/session/apps/%s/users/%s",
			url.PathEscape(c.appID), url.PathEscape(userID)), nil, nil)
}

// maxErrorBody caps how much of an error response we read, so a misbehaving
// upstream cannot exhaust memory.
const maxErrorBody = 8 << 10

func (c *HTTPClient) do(ctx context.Context, method, path string, in, out any) error {
	var reader io.Reader
	if in != nil {
		payload, err := json.Marshal(in)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUpstream, err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxErrorBody))
		_ = resp.Body.Close()
	}()

	if resp.StatusCode >= 400 {
		return c.classify(resp)
	}
	if out == nil {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("%w: decode response: %v", ErrUpstream, err)
	}
	return nil
}

// Error is a classified failure from the Prelude API.
//
// Kind is one of the sentinels above, so errors.Is keeps working for callers
// that only need to know which condition occurred. Detail carries the upstream
// message as its own field, which is what lets a handler render it without
// cutting it back out of a formatted string — a coupling to this package's
// exact wrapping format that no compiler or test would have caught breaking.
type Error struct {
	Kind   error
	Detail string
	Status int
}

func (e *Error) Error() string {
	if e.Detail == "" {
		return e.Kind.Error()
	}
	return e.Kind.Error() + ": " + e.Detail
}

func (e *Error) Unwrap() error { return e.Kind }

// classify maps an error response onto a sentinel the handler can act on.
//
// A duplicate email must surface as a 409 rather than a generic upstream
// failure, because it is the single most common registration outcome and the
// only one the user can fix themselves.
func (c *HTTPClient) classify(resp *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBody))

	var body apiError
	_ = json.Unmarshal(raw, &body)

	detail := body.Message
	if detail == "" {
		detail = body.Detail
	}
	if detail == "" {
		detail = string(raw)
	}

	switch resp.StatusCode {
	case http.StatusConflict:
		return &Error{Kind: ErrDuplicateIdentifier, Detail: detail, Status: resp.StatusCode}
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		// Prelude reports both "this email already exists" and "this password is
		// too weak" as 400s on some endpoints, distinguished only by the body.
		if containsAny(detail+body.Code, "already", "duplicate", "exists", "taken") {
			return &Error{Kind: ErrDuplicateIdentifier, Detail: detail, Status: resp.StatusCode}
		}
		if containsAny(detail+body.Code, "password", "compliance", "compliancy", "weak") {
			return &Error{Kind: ErrWeakPassword, Detail: detail, Status: resp.StatusCode}
		}
		return fmt.Errorf("%w: %s (status %d)", ErrUpstream, detail, resp.StatusCode)
	default:
		return fmt.Errorf("%w: %s (status %d)", ErrUpstream, detail, resp.StatusCode)
	}
}

func containsAny(haystack string, needles ...string) bool {
	lower := strings.ToLower(haystack)
	for _, n := range needles {
		if strings.Contains(lower, n) {
			return true
		}
	}
	return false
}
