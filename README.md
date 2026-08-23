# Songfolio

A multilingual song lyrics catalog: browse, search, and edit lyrics with rich
metadata, and collect songs into personal lists. It ships as
[songfolio.live](https://songfolio.live); the repository, the Go module and the
App Platform app are all still named `lyrics`.

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
`PRELUDE_APP_ID` and `PRELUDE_SESSION_DOMAIN` across for you — there is no second
copy to keep in sync.

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
Everything below must be configured before the API will run.

### 1. Create the application and get the keys

From the Prelude dashboard, note the **application ID** and create a
**Management API key**. Put both in `.env`:

```dotenv
PRELUDE_APP_ID=your-app-id
PRELUDE_API_KEY=sk_live_...
```

The app ID names the application to the Management API, and — until a custom
domain is registered in the next step — determines both the JWKS URL
(`https://<app_id>.session.prelude.dev/.well-known/jwks.json`) and the expected
token issuer, so it must match exactly. The API fetches the key set at startup,
which means a wrong value fails immediately rather than at the first login.

**The API key is server-side only.** It can create and delete users; it must
never reach a browser.

### 2. Add a custom session domain — required in production

Prelude Auth authenticates with cookies, and by default it serves them from
`<app_id>.session.prelude.dev` — a third party to this site, which every modern
browser is entitled to block. A subdomain of the site itself is first-party, so
the cookies survive. Register it on the application:

```bash
curl -X POST "https://api.prelude.dev/v2/session/apps/${PRELUDE_APP_ID}/domains" \
  -H "Authorization: Bearer ${PRELUDE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"domain":"auth.songfolio.live"}'
```

The response carries the domain's `id` (`dom_…`) and the `cname_record` to point
at. Add that CNAME at the DNS provider — **unproxied**: behind Cloudflare's proxy
the record's target is hidden and TLS is terminated there, so Prelude can neither
validate the record nor issue a certificate. Then ask it to check:

```bash
curl -X POST "https://api.prelude.dev/v2/session/apps/${PRELUDE_APP_ID}/domains/${DOMAIN_ID}/validate" \
  -H "Authorization: Bearer ${PRELUDE_API_KEY}"
```

`status: active` means the certificate is issued and the host is serving;
`GET .../domains/${DOMAIN_ID}` re-reads it. Both stacks then have to agree on
that host, which is what the one setting is for:

```dotenv
PRELUDE_SESSION_DOMAIN=auth.songfolio.live
```

The API derives the JWKS URL and the expected `iss` from it; the frontend build
derives the SDK's domain from the same value. That sharing is load-bearing,
because **Prelude's issuer is per-host** — the custom domain's
`/.well-known/oauth-authorization-server` advertises the custom domain, and the
default host advertises the default. Point the two halves at different hosts and
every token is rejected as *"Access token is invalid or has expired"*. Leaving
the setting blank puts both back on the default host, which is how local
development runs: `localhost` cannot be a subdomain of the deployed site anyway.

Both hosts serve the same key set, so switching invalidates nothing signed
earlier. It does sign everyone out — the refresh cookie is `__Host-`-prefixed and
therefore host-scoped, so the browser will not send the old host's copy to the
new one.

If sign-in fails after the switch with that same message, the issuer did not
follow the host after all: set `PRELUDE_ISSUER=<app_id>.session.prelude.dev`,
which is a RUN_TIME value and so one env flip rather than a rebuild.

### 3. Enable password login

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

### 4. Add the `email` custom claim — required

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

### 5. Enable email verification — required for sign-up

New accounts must confirm their address before the API will do anything for
them. Prelude proves the address with a **step-up challenge**: it emails a
six-digit code, checks the code itself, and signs the granted scope into the
access token. Two things have to exist on the application.

A step-up configuration declaring the scope, in `direct` mode so Prelude runs
the challenge without calling back into anything of ours:

```bash
curl -X POST "https://api.prelude.dev/v2/session/apps/${PRELUDE_APP_ID}/config/stepup" \
  -H "Authorization: Bearer ${PRELUDE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "step_keys": [],
    "allowed_scopes": [{
      "scope": "email:verify",
      "mode": "direct",
      "direct": {
        "identifier_types": ["email_address"],
        "status": "review",
        "granted_for": 600,
        "grant_mode": "session-bound",
        "steps": [{ "order": 1, "key": "verify_email", "expiration_duration": 600 }]
      }
    }]
  }'
```

The scope name appears in three places that must agree: this configuration,
`EMAIL_VERIFY_SCOPE` in `web/src/auth/AuthProvider.tsx`, and `EmailVerifyScope`
in `backend/internal/api/auth.go`.

`grant_mode: session-bound` is deliberate. A `single-use` grant rides on exactly
one token, and the client refreshes between completing the challenge and telling
the API about it — which would drop the proof on the floor. Session-bound keeps
it for `granted_for` seconds, so any token minted in that window still carries
it.

**Not** an OTP *login* configuration. `POST /v2/session/apps/{id}/config/login/otp`
would also send codes, but it does so by enabling passwordless sign-in for every
account: anyone able to read a mailbox could then take over the account it
belongs to, without the password. Verification must not buy that. The step-up
route sends the same code and grants only the one scope.

Password reset is the one flow that does need such a configuration, because it
has to mail a visitor who cannot sign in at all — see step 6. Verification still
does not use it, and the two must not be merged: this one grants a scope to a
session that already exists, that one produces the session.

The `verify_email` step needs a way to deliver mail, so an application that has
never sent anything may need Verify provisioned or funded on the Prelude
account. A failure shows up as a non-2xx on `POST /v1/session/otp`, after
`POST /v1/session/stepup/request` has already answered 200.

### 6. Enable password writes — required for "Forgot your password?" and for changing a password

Prelude opens step-up challenges only on sessions that already exist, and somebody
who has forgotten their password has none. The reset therefore mails a code
through an **OTP login configuration**, signs the visitor in with it, and only
then steps up for `prld:pwd:write` — Prelude's own scope for writing a password,
which it consumes as the password is written.

```bash
curl -X POST "https://api.prelude.dev/v2/session/apps/${APP_ID}/config/login/otp" \
  -H "Authorization: Bearer ${PRELUDE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "config_type": "otp",
    "channel_type": "email",
    "is_default": false,
    "code_size": 6
  }'
```

`is_default: false` is deliberate: it keeps an emailed code from being offered as
an ordinary way to sign in. The reset names this configuration explicitly, so put
the `lcfg_...` the call returns in `.env` —

```dotenv
PRELUDE_OTP_LOGIN_CONFIG_ID=lcfg_...
```

— which `make web` and `scripts/deploy-do.sh` map to
`VITE_PRELUDE_OTP_LOGIN_CONFIG_ID`. The deploy refuses to run without it; a dev
server started without it shows "Password reset is not configured for this
deployment." on the first screen rather than failing as though Prelude were down.

Then add `prld:pwd:write` to the step-up configuration from step 5. **`PUT`, not
`POST`** — the create call answers `409 step_up_config_already_exists`, and the
body replaces the whole configuration, so it has to carry the `email:verify`
entry as well or sign-up verification stops working:

```bash
curl -X PUT "https://api.prelude.dev/v2/session/apps/${APP_ID}/config/stepup" \
  -H "Authorization: Bearer ${PRELUDE_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "jwks_url": "",
    "step_keys": [],
    "allowed_scopes": [
      { "scope": "email:verify", "...": "exactly as in step 5" },
      {
        "scope": "prld:pwd:write",
        "mode": "direct",
        "direct": {
          "identifier_types": ["email_address"],
          "status": "review",
          "grant_mode": "session-bound",
          "granted_for": 300,
          "steps": [{ "order": 1, "key": "verify_email", "expiration_duration": 600 }]
        }
      }
    ]
  }'
```

`status: review` makes Prelude email a code before it grants the scope, and this
entry's policy is shared by every flow that writes a password: there is one
step-up configuration, one entry per scope, and `requestStepUp` names a scope and
nothing else. So the strictest flow decides it, and that is the signed-in "change
password" screen: it has nothing to offer but the session that asked,
which is exactly what a stolen session is, so a code is the only proof available
to it. `continue` would grant the scope to any live session and reduce that
screen to decoration.

The reset pays for that with a second code — one to sign in, one to permit the
write, proving the same mailbox seconds apart. Both statuses are handled by the
client, so this entry can be flipped back to `continue` with no deploy and no
window where reset is broken: the reset then asks for one code again, and the
change-password screen refuses itself and says why. `granted_for` is the window
the password form has to be finished in — a slower visitor is refused with
nothing wrong with the password they chose, which the screens name as a case of
its own — and `expiration_duration` is how long the emailed code lasts.

Nothing else has to be configured for **`/change-password`**, the screen a
signed-in visitor reaches from their profile. It runs this same step-up, so the
code it emails is the whole of its proof: a "current password" field would be
checked by nothing (the browser cannot verify one, and the step-up has no step
that does), which is why the screen does not ask for one.

Neither flow touches this API: the codes and the new password all go from the
browser to Prelude, and the backend only ever answers `GET /me`.

### 7. Bootstrap an admin

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
Browser ──── loginWithPassword / refresh ────► auth.songfolio.live
   │                                            (Prelude, custom domain)
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

**Email verification runs server-side, and its outcome lives here too.**
Registration signs the user in and emails them a six-digit code; until they
enter it, the API answers every authenticated route with 403 except `GET /me`
and the two verification endpoints, and the app holds them on the verification
screen. The code is sent and checked by the Go API calling the same session
endpoints the browser SDK would (`POST /v1/session/otp`, then
`/v1/session/otp/check`) — a browser-side check could only be reported back as
the client's own word for it, since an access token carries no claim saying how
its session was established. The `X-Verification-Token` those calls turn on
never leaves the server: it is the credential the code is submitted with.

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

Anything returning more than one song — browse, search, and a list's songs —
omits `lyrics`: no such view renders the body, and it outweighs the rest of a
page several times over. A search hit carries a highlighted `snippet` instead.
`GET /songs/{id}` and the create/update responses include it. The field is
absent rather than empty, so a song with no lyrics recorded stays
distinguishable from one whose body simply was not asked for.

```
GET    /health
GET    /songs            ?q=&artist=&composer=&lyricist=&genre_slug=&language=
                          &year_from=&year_to=&sort=&limit=&offset=
GET    /songs/{id}
GET    /people           ?q=&role=
GET    /genres
GET    /lists/{id}                       public lists, or your own
GET    /users/{id}/avatar                a profile picture; 404 when there is none
POST   /auth/register

GET    /me                               ┐ signed in, address not yet verified
POST   /auth/verify-email                ┘ (no body; reads the step-up grant)

PATCH  /me                               ┐
POST   /me/avatar        (image bytes)   │
DELETE /me/avatar        (no body)       │
GET    /lists                            │ signed in, address verified
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

A profile picture is read without authentication and written only by its owner.
It has to be: an `<img>` carries no `Authorization` header, so a picture behind
authentication would not load for the person it belongs to. Both writes answer
with the updated user; the upload takes raw image bytes, not a JSON field, and
is capped at 1 MB — the API center-crops whatever arrives to a square, shrinks
that square to 256px if it is larger, and re-encodes it as JPEG, which is also
what strips the EXIF metadata a phone photo carries, so every stored picture is
a small square whichever client wrote it. `GET` serves it with an `ETag` and
five minutes of `Cache-Control`. The app appends the picture's
`avatar_updated_at` to the URL, so a *replacement* is a new address and appears
at once — but a removal has no new version to point anyone at and nothing that
recalls the old one, which is what the window is sized for: it is how long a
removed picture may still be served to everybody else. The `ETag` is what keeps
that cheap, a revalidation being a 304 rather than another copy of the image.

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
signed-in spec talks directly to the session domain from the browser — the SDK
owns the session and never routes through our API, so it
cannot be stubbed. Its account must already be **verified**, or the run stops
on the verification screen with a code only a human inbox can supply. It skips
itself unless you provide real credentials:

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
