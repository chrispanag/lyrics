# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
FROM golang:1.25-alpine AS build

WORKDIR /src

# Dependencies are copied first so the module download layer is reused whenever
# only application source has changed.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .

# CGO is off so the result is a static binary that runs on a scratch-like base.
# The symbol table and DWARF data are stripped: they are only useful with a
# debugger attached, which is not how this image is meant to be used.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# --- runtime -----------------------------------------------------------------
FROM alpine:3.21

# ca-certificates is required: the API calls the Prelude Management API and
# fetches the JWKS over TLS, both of which fail without a trust store.
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 -h /app app

WORKDIR /app
COPY --from=build /out/api /app/api

USER app
EXPOSE 8080

# The binary probes itself, so the image needs no curl or wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/api", "-healthcheck"]

ENTRYPOINT ["/app/api"]
