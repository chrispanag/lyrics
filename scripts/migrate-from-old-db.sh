#!/usr/bin/env bash
#
# Migrate the song catalog from the old (TypeORM/DigitalOcean) database into
# this one, in two stages: export to NDJSON, then load.
#
# The intermediate file is kept rather than piped straight through, because it
# is the only artifact that survives if the load has to be re-run — and the old
# database sits behind a trusted-sources firewall that may not be open next
# time.
#
# Usage:
#   OLD_DATABASE_URL=postgres://... ./scripts/migrate-from-old-db.sh [--dry-run]
#
# DATABASE_URL points at the target and is read from .env by the Makefile
# wrapper (`make migrate-catalog`); set it directly when calling this script.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

: "${OLD_DATABASE_URL:?set OLD_DATABASE_URL to the source database connection string}"
: "${DATABASE_URL:?set DATABASE_URL to the target database connection string}"

# Resolved against the repository root, and left alone if already absolute, so
# the `cd backend` below cannot change which file is meant.
OUT="${OUT:-songs.ndjson}"
[[ "$OUT" == /* ]] || OUT="$PWD/$OUT"

DRY_RUN=()
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=(-dry-run)

echo "==> exporting from the old database"
# -A (unaligned) and -t (tuples only) are what keep the output valid NDJSON;
# ON_ERROR_STOP makes a failed query a non-zero exit instead of an empty file.
psql "$OLD_DATABASE_URL" -v ON_ERROR_STOP=1 -At -f scripts/export-old-db.sql > "$OUT"
echo "    $(wc -l < "$OUT" | tr -d ' ') songs written to $OUT"

echo "==> loading into the target database"
cd backend
# bash 3.2 — still the system bash on macOS — expands "${arr[@]}" on an *empty*
# array to an unbound variable error under `set -u`. That would break exactly
# the real-import path and leave the dry run working, so the ${arr[@]+...}
# guard is load-bearing rather than decorative.
go run ./cmd/import-songs -database-url "$DATABASE_URL" -file "$OUT" ${DRY_RUN[@]+"${DRY_RUN[@]}"}
