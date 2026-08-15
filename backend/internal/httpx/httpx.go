// Package httpx holds the HTTP plumbing shared by every handler: the JSON
// response envelope, the error taxonomy, and request decoding helpers.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
)

// ErrorCode is a stable, machine-readable identifier for a failure. Clients branch
// on these; the human-readable message may change without notice.
type ErrorCode string

const (
	CodeBadRequest   ErrorCode = "bad_request"
	CodeValidation   ErrorCode = "validation_failed"
	CodeUnauthorized ErrorCode = "unauthorized"
	CodeForbidden    ErrorCode = "forbidden"
	CodeNotFound     ErrorCode = "not_found"
	CodeConflict     ErrorCode = "conflict"
	CodeRateLimited  ErrorCode = "rate_limited"
	CodeUpstream     ErrorCode = "upstream_error"
	CodeInternal     ErrorCode = "internal_error"
)

// APIError is the canonical error type returned by handlers. Handlers return it;
// the Handler wrapper renders it. Anything else becomes a 500 with the detail
// logged but not disclosed.
type APIError struct {
	Status  int               `json:"-"`
	Code    ErrorCode         `json:"code"`
	Message string            `json:"message"`
	Details map[string]string `json:"details,omitempty"`
	// cause is logged server-side and never serialized to the client.
	cause error
}

func (e *APIError) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *APIError) Unwrap() error { return e.cause }

// WithCause attaches an internal error for logging. The cause never reaches the client.
func (e *APIError) WithCause(err error) *APIError {
	clone := *e
	clone.cause = err
	return &clone
}

// WithDetails attaches field-level context, typically validation failures.
func (e *APIError) WithDetails(details map[string]string) *APIError {
	clone := *e
	clone.Details = details
	return &clone
}

func newErr(status int, code ErrorCode, format string, args ...any) *APIError {
	return &APIError{Status: status, Code: code, Message: fmt.Sprintf(format, args...)}
}

func BadRequest(format string, args ...any) *APIError {
	return newErr(http.StatusBadRequest, CodeBadRequest, format, args...)
}

func Validation(format string, args ...any) *APIError {
	return newErr(http.StatusUnprocessableEntity, CodeValidation, format, args...)
}

func Unauthorized(format string, args ...any) *APIError {
	return newErr(http.StatusUnauthorized, CodeUnauthorized, format, args...)
}

func Forbidden(format string, args ...any) *APIError {
	return newErr(http.StatusForbidden, CodeForbidden, format, args...)
}

func NotFound(format string, args ...any) *APIError {
	return newErr(http.StatusNotFound, CodeNotFound, format, args...)
}

func Conflict(format string, args ...any) *APIError {
	return newErr(http.StatusConflict, CodeConflict, format, args...)
}

func RateLimited(format string, args ...any) *APIError {
	return newErr(http.StatusTooManyRequests, CodeRateLimited, format, args...)
}

func Upstream(format string, args ...any) *APIError {
	return newErr(http.StatusBadGateway, CodeUpstream, format, args...)
}

func Internal(format string, args ...any) *APIError {
	return newErr(http.StatusInternalServerError, CodeInternal, format, args...)
}

// envelope wraps error responses so clients always parse the same shape.
type errorEnvelope struct {
	Error *APIError `json:"error"`
}

// ListMeta describes pagination for a collection response.
type ListMeta struct {
	Total  int `json:"total"`
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

// ListResponse is the shape of every collection endpoint.
type ListResponse[T any] struct {
	Data []T      `json:"data"`
	Meta ListMeta `json:"meta"`
}

// NewListResponse builds a list payload, normalizing a nil slice to `[]` so
// clients never have to distinguish null from empty.
func NewListResponse[T any](data []T, total, limit, offset int) ListResponse[T] {
	if data == nil {
		data = []T{}
	}
	return ListResponse[T]{Data: data, Meta: ListMeta{Total: total, Limit: limit, Offset: offset}}
}

// JSON writes a value as a JSON response with the given status.
func JSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if payload == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		// The status line is already written, so this can only be logged.
		slog.Error("failed to encode response body", "error", err)
	}
}

// NoContent writes a bodiless success response.
func NoContent(w http.ResponseWriter) { w.WriteHeader(http.StatusNoContent) }

// HandlerFunc is a handler that may fail. Returning an error is the only way to
// produce an error response, which keeps the envelope consistent by construction.
type HandlerFunc func(http.ResponseWriter, *http.Request) error

// Handler adapts a fallible handler into a standard http.Handler.
func Handler(fn HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			WriteError(w, r, err)
		}
	}
}

// WriteError renders an error using the standard envelope. Unrecognized errors
// are reported as a generic 500: the detail is logged, never disclosed, since an
// internal error message can leak schema or infrastructure details.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		apiErr = Internal("An unexpected error occurred.").WithCause(err)
	}

	logger := slog.With(
		"method", r.Method,
		"path", r.URL.Path,
		"status", apiErr.Status,
		"code", string(apiErr.Code),
	)
	if apiErr.Status >= 500 {
		logger.Error("request failed", "error", apiErr.Error())
	} else {
		logger.Debug("request rejected", "error", apiErr.Error())
	}

	JSON(w, apiErr.Status, errorEnvelope{Error: apiErr})
}

// maxBodyBytes caps request bodies. Lyrics are the largest thing we accept and a
// megabyte is far beyond the longest song ever written.
const maxBodyBytes = 1 << 20

// DecodeJSON reads and validates a JSON request body. Unknown fields are rejected
// so that a typo in a client payload surfaces as an error instead of being
// silently ignored.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	if ct := r.Header.Get("Content-Type"); ct != "" &&
		ct != "application/json" && ct != "application/json; charset=utf-8" {
		return BadRequest("Content-Type must be application/json.")
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		var syntaxErr *json.SyntaxError
		var typeErr *json.UnmarshalTypeError

		switch {
		case errors.As(err, &maxErr):
			return BadRequest("Request body must not exceed %d bytes.", maxBodyBytes)
		case errors.As(err, &syntaxErr):
			return BadRequest("Request body contains malformed JSON at position %d.", syntaxErr.Offset)
		case errors.As(err, &typeErr):
			return BadRequest("Field %q expects a %s value.", typeErr.Field, typeErr.Type)
		case errors.Is(err, io.EOF):
			return BadRequest("Request body must not be empty.")
		default:
			return BadRequest("Request body could not be parsed.").WithCause(err)
		}
	}

	// A second value would mean the client sent a JSON stream, not an object.
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return BadRequest("Request body must contain exactly one JSON object.")
	}
	return nil
}

// Pagination limits for collection endpoints.
const (
	DefaultLimit = 20
	MaxLimit     = 100
)

// Pagination reads limit/offset query parameters, clamping them to sane bounds
// rather than erroring: a client asking for 10,000 rows gets the maximum page.
//
// It takes the already-parsed query rather than the request because
// url.URL.Query() re-parses RawQuery and allocates a fresh map on every call;
// a listing handler reads several parameters and would otherwise pay for the
// same parse once per parameter.
func Pagination(q url.Values) (limit, offset int) {
	limit, offset = DefaultLimit, 0

	if raw := q.Get("limit"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			limit = min(v, MaxLimit)
		}
	}
	if raw := q.Get("offset"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			offset = v
		}
	}
	return limit, offset
}
