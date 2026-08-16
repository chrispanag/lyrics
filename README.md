# Lyrics

A multilingual song lyrics catalog: browse, search, and edit lyrics with rich
metadata, and collect songs into personal lists.

- **Backend** — Go REST API, PostgreSQL
- **Frontend** — React + TypeScript, mobile-first
- **Auth** — [Prelude Auth](https://docs.prelude.so/auth/documentation/introduction),
  email and password

Guests can browse and search the whole catalog. Signed-in users build lists,
contributors add songs, admins manage everything.

---

## Quick start

```bash
cp .env.example .env      # then fill in the Prelude values (see below)
make up                   # start PostgreSQL
make seed                 # apply migrations and load sample songs
make api                  # run the API on :8080

# in a second terminal
make install && make web  # run the web app on :5173
```

Vite only exposes variables prefixed with `VITE_`, so `make web` maps
`PRELUDE_APP_ID` across for you — there is no second copy to keep in sync.

`make help` lists every target.

### Testing from a phone

`make mobile` runs the same dev server and prints a `Network:` URL to open on
any device on the network. It differs from `make web` in one way: it clears
`VITE_API_BASE_URL`, so the app calls its own origin and Vite proxies `/api` to
the API over loopback — one origin, as in production, and no CORS entry to add.

Pointing a phone straight at `:8080` instead does not work: macOS blocks
incoming connections to the unsigned binary `go run` builds, so the port answers
on localhost and hangs from the network. Approving it in System Settings →
Network → Firewall is only worth it to call the API without the app.

**Signing in will fail there.** A `http://<ip>` page is not a secure context, so
the browser withholds `crypto.subtle`, which the Prelude SDK needs to mint its
device key. Browsing, search, song pages and public lists all work; for the
signed-in surface, reach the dev server over HTTPS (a tunnel, or a locally
trusted certificate).

Without Prelude credentials the API refuses to start — see
[Prelude setup](#prelude-setup). The database, migrations, seed data, and the
whole backend test suite all work without them.

---

## Prelude setup

Prelude owns credentials and sessions; this application owns authorization.
Three things must be configured before the API will run.

### 1. Create the application and get the keys

From the Prelude dashboard, note the **application ID** and create a
**Management API key**. Put both in `.env`:

```dotenv
PRELUDE_APP_ID=your-app-id
PRELUDE_API_KEY=sk_live_...
```

The app ID determines both the JWKS URL
(`https://<app_id>.session.prelude.dev/.well-known/jwks.json`) and the expected
token issuer, so it must match exactly. The API fetches the key set at startup,
which means a wrong value fails immediately rather than at the first login.

**The API key is server-side only.** It can create and delete users; it must
never reach a browser.

### 2. Enable password login

Every field is required — the API rejects a partial body.

```bash
curl -X POST "https://api.prelude.dev/v2/session/apps/${PRELUDE_APP_ID}/config/login/password" \
  -H "Authorization: Bearer ${PRELUDE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "hash_method": "argon2id",
    "enabled": true,
    "rate_limit_login_ip":         { "ttl": 3600, "limit": 10 },
    "rate_limit_login_identifier": { "ttl": 3600, "limit": 10 },
    "password_compliancy": {
      "min_length": 8, "max_length": 128,
      "uppercase": 0, "lowercase": 0, "numbers": 0, "symbols": 0
    }
  }'
```

The compliancy numbers are minimum counts of each character class; zero means
"not required". Tighten them here and the sign-up form picks the new rules up
automatically — it asks Prelude to validate and shows whatever it returns.

The composition rules live here and are deliberately **not** duplicated in this
codebase: a second copy would drift and start rejecting passwords Prelude would
accept. The sign-up form asks Prelude to validate as you type, and surfaces its
messages verbatim.

### 3. Add the `email` custom claim — required

```bash
curl -X POST "https://api.prelude.dev/v2/session/apps/${PRELUDE_APP_ID}/config/claims" \
  -H "Authorization: Bearer ${PRELUDE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "mapping": {
      "user_id": { "$input": "user_id", "$type": "uuid" },
      "email":   { "$input": "emails",  "$type": "string" }
    }
  }'
```

Two things about the resulting token are worth knowing, because both are easy to
get wrong and fail in ways that look like an expired session:

- **`sub`, not `user_id`, is the join key.** `sub` is the `usr_...` identifier
  the Management API returns when creating a user, and is what
  `users.prelude_user_id` stores. The `user_id` claim resolves to Prelude's
  separate internal UUID for the same account.
- **The token's `iss` is the bare host** (`<app_id>.session.prelude.dev`) while
  the OAuth metadata advertises it with an `https://` scheme. The verifier
  compares hosts and accepts either.

The `emails` input resolves to the user's **verified** email identifiers. Access
tokens carry no email unless you map one. The API needs it for two things:

- **Just-in-time provisioning** — a valid token for an account this database
  has never seen (created in the Prelude dashboard, or lost to a restore from
  an older backup) creates the local record on first request instead of
  returning a confusing 403.
- **Admin bootstrap** — matching `ADMIN_EMAILS`.

Without the claim, existing users still work, but a first-time sign-in fails
with `Account cannot be provisioned`.

### 4. Bootstrap an admin

```dotenv
ADMIN_EMAILS=you@example.com
```

The first account matching one of these gets the `admin` role. **Nothing else
can create the first admin** — roles are only changeable by an admin, so
without this entry nobody can ever be promoted.

This applies at provisioning time only: adding an email here later does not
promote an account that already exists. Promote it from **Admin → Users**, or
in SQL:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

---

## Architecture

```
Browser ──── loginWithPassword / refresh ────► <app_id>.session.prelude.dev
   │                                                    (Prelude)
   │  Authorization: Bearer <access token>
   ▼
 Go API ──── verify JWT against JWKS ───────► same domain
   │    └─── create user, set password ─────► api.prelude.dev  (Management API)
   ▼
PostgreSQL   users · songs · people · genres · lists
```

**Registration goes through our backend.** The browser SDK can log a user in
but cannot sign one up — creating a user is a Management API call needing the
API key. `POST /api/v1/auth/register` makes two upstream calls, and deletes the
account if the second fails: a user created without a password can neither sign
in nor register again, permanently burning that address.

**Roles live in this database, not in the token.** Prelude supports custom
claims, but baking a role into a JWT means a promotion does not take effect
until the token refreshes. Here it applies on the very next request.

### Search

The corpus mixes Greek and English, which rules out a stemmed configuration —
running a Greek line through the English Snowball stemmer produces garbage, and
vice versa. Instead:

| Layer | Purpose |
|---|---|
| `app_norm()` | Lowercase + strip diacritics. Backs the stored vector, the parsed query, and every trigram index, so both sides of a comparison normalize identically. |
| `app_simple` | Text search configuration that unaccents at dictionary level, so `ts_headline` can highlight accented source text. |
| Weighted `tsvector` | Title **A**, alt title and credits **B**, genres **C**, lyrics **D** — a title hit scores ten times a lyrics-body hit. |
| Prefix matching | Every term gets `:*`. With no stemmer this is the only recall mechanism for an inflected language: it is what connects a search for `θαλασσα` to the lyric `θάλασσας`. |
| `word_similarity` | Fuzzy fallback for misspelled titles and artists, scored against the best-matching run of words rather than the whole field. |

Two behaviors here are easy to break and are pinned by tests:

- **`app_norm` must stay equivalent to what `app_simple` does to raw text.** An
  earlier version also folded Greek final sigma. Matching still worked, but
  `ts_headline` reads the *raw* lyrics and has no such folding — so every
  snippet for a Greek word ending in ς silently lost its highlighting.
- **Snippets are delimited with `⟦…⟧`, not `<b>`.** `ts_headline` returns the
  source verbatim, so markup a contributor typed comes back untouched. The
  client splits on the sentinels and builds elements, making injection
  structurally impossible instead of merely filtered.

---

## Roles

| | Guest | User | Contributor | Admin |
|---|:-:|:-:|:-:|:-:|
| Browse and search | ✓ | ✓ | ✓ | ✓ |
| Create and manage lists | | ✓ | ✓ | ✓ |
| Reorder, share and copy lists | | ✓ | ✓ | ✓ |
| Add songs | | | ✓ | ✓ |
| Edit **own** songs | | | ✓ | ✓ |
| Edit and delete **any** song | | | | ✓ |
| Manage people, genres, users | | | | ✓ |

The last admin cannot be demoted or deleted, since that would leave the
platform with no way to appoint another.

---

## API

All routes are under `/api/v1`. Errors use
`{"error": {"code", "message", "details"}}`; collections use
`{"data": [...], "meta": {"total", "limit", "offset"}}`.

```
GET    /health
GET    /songs            ?q=&artist=&composer=&lyricist=&genre_slug=&language=
                          &year_from=&year_to=&sort=&limit=&offset=
GET    /songs/{id}
GET    /people           ?q=&role=
GET    /genres
GET    /lists/{id}                       public lists, or your own
POST   /auth/register

GET    /me                               ┐
PATCH  /me                               │
GET    /lists                            │ signed in
POST   /lists                            │
PATCH  /lists/{id}                       │
DELETE /lists/{id}                       │
POST   /lists/{id}/copy  (public or own) │
PUT    /lists/{id}/songs/{songID}        │
DELETE /lists/{id}/songs/{songID}        │
POST   /lists/{id}/reorder               │
GET    /songs/{id}/lists                 ┘

POST   /songs                            ┐
PATCH  /songs/{id}   (own songs)         │ contributor
POST   /people                           │
POST   /genres                           ┘

PATCH  /songs/{id}   (any)               ┐
DELETE /songs/{id}                       │
PATCH  /people/{id}  DELETE /people/{id} │ admin
PATCH  /genres/{id}  DELETE /genres/{id} │
GET    /admin/users                      │
PATCH  /admin/users/{id}/role            │
DELETE /admin/users/{id}                 ┘
```

Try it without signing in:

```bash
curl 'localhost:8080/api/v1/songs?q=θάλασσα'      # accented
curl 'localhost:8080/api/v1/songs?q=θαλασσα'      # unaccented — same results
curl 'localhost:8080/api/v1/songs?q=Θεοδορακης'   # misspelled artist — still matches
```

---

## Testing

```bash
make test          # backend (race detector) + frontend
make lint          # golangci-lint, go vet, tsc, eslint
make check         # both
```

Backend integration tests run against a real PostgreSQL, because everything
they cover — the generated search vector, the denormalization triggers,
`ts_headline`, trigram ranking — lives in the database and cannot be exercised
by a fake. Each test binary gets its own database (`go test ./...` runs packages
in parallel, and a shared one means each package truncates the other's fixtures
mid-test). They **skip** rather than fail when no database is reachable, so
`make test-backend` starts one first.

Token verification is tested against a locally generated key set served by
`httptest`, which is the only way to produce expired, wrong-issuer, and
`alg: none` tokens on demand.

### Running the end-to-end tests

Browsers are downloaded separately, once:

```bash
cd web && npx playwright install chromium
make e2e
```

The guest-browsing specs need only a running stack with seeded data. The
signed-in spec talks directly to `<app_id>.session.prelude.dev` from the
browser — the SDK owns the session and never routes through our API, so it
cannot be stubbed. It skips itself unless you provide real credentials:

```bash
VITE_PRELUDE_APP_ID=... E2E_USER_EMAIL=... E2E_USER_PASSWORD=... make e2e
```

Point the suite at an already-running stack with `E2E_BASE_URL=http://localhost:5173`;
otherwise Playwright starts its own dev server.

---

## Importing the old catalog

The previous version of this app kept its songs in a DigitalOcean-managed
PostgreSQL 14 database with a TypeORM schema (`song`, `person`,
`song_to_person`). Migrating it runs in two stages:

```bash
export OLD_DATABASE_URL='postgres://db:PASSWORD@app-....ondigitalocean.com:25060/db?sslmode=require'
make migrate-catalog ARGS=--dry-run   # validate, write nothing
make migrate-catalog                  # export, then load
```

The stages are separate so the exported `songs.ndjson` survives a failed load —
the old database sits behind a trusted-sources firewall, and the machine's IP
has to be on it. A timeout on port 25060 means it is not.

To load an export you already have, skip straight to the second stage:

```bash
make import-songs FILE=songs.ndjson
```

**How the schemas line up.** The interchange format is NDJSON, one object per
song, so the exporter and loader can be tested independently:

| Old                                | New                     | Notes                                            |
| ---------------------------------- | ----------------------- | ------------------------------------------------ |
| `song.title` / `altTitle`          | `songs.title` / `alt_title` | blank alt titles become NULL              |
| `song.year` (varchar)              | `songs.release_year` (int)  | only a bare four-digit value converts     |
| `person.firstName` + `lastName`    | `people.name`           | upserted on `normalized_name`                    |
| `song_to_person.role = 'composer'` | `song_credits` `composer` |                                                |
| `song_to_person.role = 'songwriter'` | `song_credits` `lyricist` | "songwriter" means whoever wrote the words |
| —                                  | `songs.language`        | the old schema has none; defaults to `el`        |

Not carried over, because the new schema has no equivalent or no safe one:
the old `user` table (identity now belongs to Prelude, so a local password hash
has nowhere to go), `song_to_user` favorites (lists need a `users` row, which
only exists once that person signs in), and `song.createdById` — use
`-actor-email` to attribute imported songs to an existing account instead.

Point this at a database that has been **migrated but not seeded**. `make seed`
loads sample songs, and `make migrate-catalog` does not remove them — they would
otherwise sit in a real catalog looking like genuine entries. `make migrate`
alone is the right preparation.

**Re-running is safe.** The load is one transaction, and a song already present
is skipped rather than duplicated — matched on its normalized title plus the set
of people credited on it. Title alone is too weak a key: the old catalog holds
seven groups of genuinely different songs that share one.

## Deploying to DigitalOcean App Platform

`.do/app.yaml` describes the whole deployment. Four components in one app:

| Component | Kind          | Built from                | Serves                          |
| --------- | ------------- | ------------------------- | ------------------------------- |
| `web`     | static site   | `web/`, Node buildpack    | `/` — the built assets, via CDN |
| `api`     | service       | `backend/Dockerfile`      | `/api` — the Go API             |
| `migrate` | pre-deploy job | `backend/Dockerfile`     | nothing; applies the schema     |
| `db`      | dev database  | managed PostgreSQL 17     | —                               |

Everything is one origin. `/api` routes to the service with the path prefix
preserved (the router mounts at `/api/v1`), and every other path falls through
to the assets, with `catchall_document` handling client-side routes. A
production build of the frontend has no API base URL compiled into it and calls
its own origin, so moving the app to another domain never means rebuilding it.

### Before the first deploy

1. **Connect the repository.** App Platform pulls from `chrispanag/lyrics`, so
   DigitalOcean's GitHub app needs access to it. This is the one step with no
   API: grant it under GitHub → Settings → Applications → DigitalOcean.
2. **Fill in `.env`** — `PRELUDE_APP_ID`, `PRELUDE_API_KEY`, `ADMIN_EMAILS`, and
   optionally `VITE_PRELUDE_SDK_KEY`. The tracked spec holds placeholders where
   these belong; `scripts/deploy-do.sh` substitutes them at request time so no
   credential is ever written to a tracked file.
3. **Get an API token** with write scope and export it as
   `DIGITALOCEAN_ACCESS_TOKEN`, or add it to `.env`.

```bash
make deploy-check   # validate the spec and price it; creates nothing
make deploy         # create the app, or update it if it already exists
```

`deploy-check` runs DigitalOcean's own dry run, which rejects a malformed spec
and reports the monthly cost. `deploy` is idempotent: it looks the app up by
name each time rather than recording an id here, so there is no local state to
drift out of date.

### What happens on each deploy

The `migrate` job runs to completion **before** any new container serves
traffic, so a request never reaches code whose migration has not landed. It is
built from the same image as the API — the migrations are compiled into the
binary with `go:embed` — which is what guarantees the schema and the code that
expects it come from one commit.

That image has no `ENTRYPOINT`, deliberately. App Platform's `run_command`
replaces a component's command, and with an `ENTRYPOINT` in place it may be
appended to the API's arguments instead — in which case the pre-deploy job
quietly starts a second web server and hangs rather than migrating. Giving up
the `ENTRYPOINT` makes the question moot.

The API still does not migrate at startup. Nothing else moves the schema
forward in production, which keeps the ordering explicit rather than racing
several booting replicas against each other.

### Loading the catalog

A fresh deployment has an empty catalog: `seed.sql` is sample data and is not
wired into the deploy. Load the real thing from the machine holding the export,
against the deployed database's connection string (DigitalOcean console → the
app → `db` → connection details):

```bash
DATABASE_URL='postgres://...?sslmode=require' make import-songs FILE=songs.ndjson
```

The load is one transaction and re-running is safe, so a failed attempt leaves
nothing to clean up.

### Custom domain

`paroles.gr` currently points at the previous app and is **not** attached here.
Moving it is a deliberate, separate step: add a `domains:` block to
`.do/app.yaml` and remove it from the old app first — two apps cannot claim the
same domain. `CORS_ORIGINS` is `${APP_URL}`, so it follows the primary domain
automatically once one is attached.

---

## Layout

```
.do/
  app.yaml           App Platform spec (see "Deploying to DigitalOcean")
backend/
  cmd/api/           entry point, graceful shutdown, -healthcheck probe
  cmd/migrate/       applies the embedded migrations; the pre-deploy job
  cmd/import-songs/  NDJSON catalog loader (see "Importing the old catalog")
  internal/
    api/             routing, request decoding, authorization, error mapping
    auth/            JWKS verification, middleware, JIT provisioning
    prelude/         Management API client (+ fake)
    store/           hand-written pgx queries, search
    config/ httpx/ testutil/
  migrations/        golang-migrate SQL, plus seed.sql
web/
  src/
    api/             typed fetch client, TanStack Query hooks
    auth/            Prelude session provider
    components/      layout, primitives, song card, autocomplete
    routes/          browse, detail, editor, lists, auth, admin
    lib/ test/
  e2e/               Playwright specs
scripts/
  export-old-db.sql       old catalog -> NDJSON
  migrate-from-old-db.sh  export + load, in one command
  deploy-do.sh            render .do/app.yaml with secrets, create or update
```

### Notes on the implementation

- **Queries are hand-written against pgx rather than generated.** Most of the
  query surface is dynamic — composable filters, a blended relevance ranking —
  which code generators model poorly.
- **Handlers return errors.** `httpx.Handler` renders them, so the response
  envelope is consistent by construction rather than by convention.
- **`created_by` is nullable.** Catalog content outlives the account that
  entered it; deleting a user leaves their songs in place.
