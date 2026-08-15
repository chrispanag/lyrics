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
#
# The migrator is built into the same image rather than one of its own: it
# shares the module cache and the embedded migrations, and a deployment that
# runs migrate and api from a single image cannot apply one commit's schema and
# then serve a different commit's code.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
        -o /out/ ./cmd/api ./cmd/migrate

# --- runtime -----------------------------------------------------------------
FROM alpine:3.21

# ca-certificates is required: the API calls the Prelude Management API and
# fetches the JWKS over TLS, both of which fail without a trust store.
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 -h /app app

WORKDIR /app
COPY --from=build /out/api /out/migrate /app/

USER app
EXPOSE 8080

# The binary probes itself, so the image needs no curl or wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/app/api", "-healthcheck"]

# CMD rather than ENTRYPOINT so the image can also be started as the migrator.
# App Platform's `run_command` replaces the command for a component, and with an
# ENTRYPOINT in place that replacement may be appended to it as arguments
# instead — leaving the pre-deploy job to start a second web server and hang.
# Without an ENTRYPOINT the ambiguity does not exist.
CMD ["/app/api"]
