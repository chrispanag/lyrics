.DEFAULT_GOAL := help

# Load .env if present so DATABASE_URL and the Prelude settings are available
# to every target without repeating them on the command line.
ifneq (,$(wildcard .env))
include .env
export
endif

DATABASE_URL ?= postgres://lyrics:lyrics@localhost:5433/lyrics?sslmode=disable
MIGRATIONS   := backend/migrations

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- environment -------------------------------------------------------------

.PHONY: up
up: ## Start Postgres and wait for it to accept connections
	docker compose up -d db
	@printf 'waiting for postgres'
	@until docker compose exec -T db pg_isready -U lyrics -d lyrics >/dev/null 2>&1; do \
		printf '.'; sleep 1; \
	done
	@echo ' ready'

.PHONY: up-all
# The API does not migrate on boot, so a fresh volume leaves it serving 500s
# behind a health check that only pings. `seed` runs migrations first.
up-all: ## Start every service (db, api, web) in Docker, then migrate and seed
	docker compose up -d --build
	$(MAKE) seed

.PHONY: down
down: ## Stop all services
	docker compose down

.PHONY: clean
clean: ## Stop services and delete the database volume
	docker compose down -v

.PHONY: logs
logs: ## Follow service logs
	docker compose logs -f

# --- database ----------------------------------------------------------------

.PHONY: migrate
migrate: up ## Apply all pending migrations
	migrate -path $(MIGRATIONS) -database "$(DATABASE_URL)" up

.PHONY: migrate-down
migrate-down: ## Roll back the most recent migration
	migrate -path $(MIGRATIONS) -database "$(DATABASE_URL)" down 1

.PHONY: migrate-status
migrate-status: ## Show the current schema version
	migrate -path $(MIGRATIONS) -database "$(DATABASE_URL)" version

.PHONY: seed
seed: migrate ## Load sample songs (Greek and English)
	psql "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f $(MIGRATIONS)/seed.sql

.PHONY: migrate-catalog
# Two stages so the exported NDJSON survives a failed load: the old database is
# behind a trusted-sources firewall and may not be reachable on a second try.
migrate-catalog: migrate ## Import the song catalog from the old database (needs OLD_DATABASE_URL)
	OUT="$(OUT)" ./scripts/migrate-from-old-db.sh $(ARGS)

.PHONY: import-songs
# The path is made absolute before the `cd`, so FILE can be given either
# relative to the repository root or as an absolute path.
import-songs: migrate ## Load songs from an existing NDJSON export (FILE=songs.ndjson)
	cd backend && go run ./cmd/import-songs \
		-database-url "$(DATABASE_URL)" -file "$(abspath $(or $(FILE),songs.ndjson))" $(ARGS)

.PHONY: db-reset
db-reset: ## Drop and rebuild the schema, then reseed
	psql "$(DATABASE_URL)" -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
	$(MAKE) seed

.PHONY: psql
psql: ## Open a psql shell
	psql "$(DATABASE_URL)"

# --- backend -----------------------------------------------------------------

.PHONY: api
api: migrate ## Run the API locally
	cd backend && DATABASE_URL="$(DATABASE_URL)" go run ./cmd/api

.PHONY: test-backend
# Integration tests skip themselves without a database, which would quietly
# turn a broken schema into a green run — so the database is a prerequisite.
test-backend: up ## Run backend tests with the race detector
	cd backend && go test ./... -count=1 -race

.PHONY: lint-backend
lint-backend: ## Lint the backend
	cd backend && golangci-lint run ./... && go vet ./...

# --- frontend ----------------------------------------------------------------

.PHONY: web
# Next only exposes variables prefixed with NEXT_PUBLIC_, so the app ID, the
# session domain and the OTP login configuration are mapped across here rather
# than duplicated in .env under two names. Four places do this mapping — here,
# the `mobile` target, docker-compose.yml (plus web/Dockerfile) and
# scripts/deploy-do.sh — so a new variable has four to be added to.
web: ## Run the web dev server
	cd web && NEXT_PUBLIC_PRELUDE_APP_ID="$(PRELUDE_APP_ID)" \
		NEXT_PUBLIC_PRELUDE_SDK_KEY="$(PRELUDE_SDK_KEY)" \
		NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN="$(PRELUDE_SESSION_DOMAIN)" \
		NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID="$(PRELUDE_OTP_LOGIN_CONFIG_ID)" npm run dev

.PHONY: mobile
# Same dev server, reached from a phone on the same network — the dev script
# binds every interface (`next dev -H 0.0.0.0`), so the address to open is this
# machine's LAN IP on :5173. Next does not print it the way Vite did; `ipconfig
# getifaddr en0` is it. Clearing NEXT_PUBLIC_API_BASE_URL (which .env sets to
# localhost, i.e. the phone itself) is what sends API calls to this origin and
# through the rewrite in next.config.ts.
#
# Sign-in will not work over such a URL: it is not a secure context, so the
# browser withholds crypto.subtle, which the Prelude SDK needs. Browsing,
# search and public lists do.
mobile: ## Run the web dev server for testing from a phone on this network
	cd web && NEXT_PUBLIC_API_BASE_URL= NEXT_PUBLIC_PRELUDE_APP_ID="$(PRELUDE_APP_ID)" \
		NEXT_PUBLIC_PRELUDE_SDK_KEY="$(PRELUDE_SDK_KEY)" \
		NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN="$(PRELUDE_SESSION_DOMAIN)" \
		NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID="$(PRELUDE_OTP_LOGIN_CONFIG_ID)" npm run dev

.PHONY: install
install: ## Install frontend dependencies
	cd web && npm install

.PHONY: test-web
test-web: ## Run frontend unit tests
	cd web && npm run test

.PHONY: lint-web
lint-web: ## Typecheck and lint the frontend
	cd web && npm run typecheck && npm run lint

.PHONY: icons
# sharp and png-to-ico are installed here rather than in web/package.json: this
# runs once per brand change, and every `npm ci` — the Dockerfile's included —
# would otherwise pay for an image toolchain no build step invokes. They cannot
# be run through `npx -p`, which puts a temp install on PATH for binaries and
# not on node's ESM resolution path, so the imports would not resolve.
icons: ## Regenerate the app icons and og card from web/icons/*.svg
	cd web/icons && npm install --no-save sharp png-to-ico && node generate.mjs

.PHONY: e2e
# Playwright starts its own `npm run dev`, so the session domain has to be mapped
# here too: without it the browser signs in against the default host while the
# API expects the custom issuer, and every signed-in spec fails on a valid login.
e2e: ## Run the Playwright smoke suite (needs Prelude credentials, see README)
	cd web && NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN="$(PRELUDE_SESSION_DOMAIN)" npm run e2e

# --- deployment --------------------------------------------------------------

.PHONY: deploy-check
deploy-check: ## Validate .do/app.yaml against the DigitalOcean API, changing nothing
	./scripts/deploy-do.sh --validate

.PHONY: deploy
deploy: ## Create or update the DigitalOcean app from .do/app.yaml
	./scripts/deploy-do.sh

# --- everything --------------------------------------------------------------

.PHONY: test
test: test-backend test-web ## Run all tests

.PHONY: lint
lint: lint-backend lint-web ## Lint everything

.PHONY: check
check: lint test ## Lint and test everything
