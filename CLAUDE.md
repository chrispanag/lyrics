# Songfolio

Multilingual song lyrics catalog (Greek + English), shipping as
`songfolio.live`. Go REST API + PostgreSQL, React/TypeScript frontend,
authentication delegated to Prelude Auth. Only the product name moved: the
repository, the Go module (`github.com/christos/lyrics/backend`), the npm
package (`lyrics-web`) and the App Platform app all still carry the `lyrics`
name, so a half-rename never has to be untangled.

Guests browse and search. Users build lists. Contributors add songs and edit
their own. Admins do everything.

`README.md` covers setup and the API surface. This file covers what is easy to
break.

---

## Commands

```bash
make up          # start PostgreSQL (host port 5433)
make seed        # migrate + load sample songs
make api         # run the API on :8080
make web         # run the web app on :5173
make check       # lint + test, both stacks
```

`make test-backend` depends on `up` deliberately: the integration tests **skip**
when no database is reachable, so without it a broken schema reports green.

Keep `make check` clean. Backend must be `gofmt`-clean with zero `golangci-lint`
findings; frontend must have zero `tsc` errors and zero eslint findings
(warnings included — the fast-refresh warnings are why styles live in their own
modules, see Conventions).

---

## Invariants that fail silently

Each of these has been broken once. None of them produced an error message that
pointed at the cause, and each is pinned by a test that names the failure.

### Search

- **`app_norm()` must stay equivalent to what the `app_simple` text search
  configuration does to raw text.** An earlier version also folded Greek final
  sigma. Matching still worked — but `ts_headline` reads the *raw* lyrics, has
  no such folding, and every snippet for a Greek word ending in ς quietly lost
  its highlighting. Matching and highlighting fail independently; test both.
- **Snippets are delimited `⟦…⟧`, never `<b>`.** `ts_headline` returns source
  text verbatim, so markup typed into lyrics comes back untouched. HTML
  delimiters would make lyrics a stored XSS vector. The client splits on the
  sentinels and builds elements, so injection is structurally impossible rather
  than filtered.
- **Fuzzy matching uses `word_similarity`, not `similarity`.** `similarity`
  scores the query against the *whole* concatenated credits field, so the score
  decays as a song gains credits and fuzzy search breaks on exactly the
  best-documented songs.
- **Everything in index and generated-column expressions is schema-qualified**
  (`public.unaccent`, `'public.app_simple'`). PostgreSQL evaluates those under a
  restricted `search_path`; an unqualified call resolves fine in an ordinary
  query and then fails at `CREATE INDEX` with "function does not exist".
- The index is deliberately **unstemmed** — the corpus mixes Greek and English,
  and each language's stemmer mangles the other. Prefix matching (`:*` on every
  term) is the only recall mechanism for Greek inflection. Do not "improve" this
  by switching to a stemmed configuration without handling both languages.

### Prelude tokens

Two properties of a real access token contradict both the docs and the app's own
OAuth metadata. Both broke sign-in, and both surfaced as *"Access token is
invalid or has expired"*:

- **`iss` is the bare host** (`<app_id>.session.prelude.dev`) while
  `/.well-known/oauth-authorization-server` advertises the `https://` form. The
  verifier compares hosts and accepts either.
- **The issuer is per-host, so the session domain is one setting for both
  stacks.** `PRELUDE_SESSION_DOMAIN` (`auth.songfolio.live`, registered so the
  session cookies are first-party rather than blockable third-party ones) is what
  the API derives its JWKS URL and expected `iss` from, and the same value
  reaches the frontend build as `VITE_PRELUDE_SESSION_DOMAIN` to become the SDK's
  `domain` — one `.env` entry mapped twice by `scripts/deploy-do.sh`, because the
  two halves naming different hosts rejects every token while both hosts look
  perfectly healthy on their own. Blank falls back to the app-id host, which is
  what local development uses. Whether `iss` really follows the custom host was
  **never confirmed against a real token** — the metadata on each host advertises
  itself, which is the evidence. If sign-in breaks with the message above, pin
  `PRELUDE_ISSUER` back to the app-id host: a RUN_TIME flip, no rebuild.
- **`sub` and `user_id` are different identifiers.** `sub` is the `usr_…` id the
  Management API returns and that `users.prelude_user_id` stores; `user_id` is
  Prelude's internal UUID. **Join on `sub`.** Joining on `user_id` matches
  nothing and re-provisions the user as a duplicate.
- Tokens live **~60 seconds** and set `nbf` to issue time. The verifier allows
  15s of clock skew; the frontend retries once after a 401 with a forced
  refresh.

Verifying with a token from `POST /tokens` does **not** catch either issue,
because the caller supplies the claims. To see a real token:
`POST /v1/session/login/email/password` → `POST /v1/session/login/finalize`.

### Email verification

Sign-up proves the address with a Prelude **step-up challenge**, and the account
is refused everything until it completes. Four parts hold that up, and none of
them announce themselves when broken:

- **The proof is a scope on a signed token, not a code this API ever sees.** The
  browser opens an `email:verify` step-up; Prelude emails the code, checks it,
  and adds the granted scope to the access token. `POST /auth/verify-email` has
  no body — it reads the scope and writes `users.email_verified_at`. Moving the
  code-checking here would mean either trusting the client's word or reaching
  for the login-OTP endpoints, and the second is what the design exists to
  avoid: an OTP *login* config would let anyone who can read a mailbox sign in
  without the password. Verification must not buy a second way in. (Password
  reset does use one — it has no session to step up from. That is a different
  trade, made deliberately; see "Password reset".)
- **`grant_mode` must stay `session-bound`.** `single-use` binds the grant to
  one token, and the client refreshes between finishing the challenge and
  posting to this API — so the proof would be gone by the time it is read, and
  the user would sit at a code form that accepts a correct code and then says
  no. `recordVerification` forces a refresh first for the same reason, to be
  sure the token it sends postdates the challenge.
- **The gate's exemption list is `GET /me` plus `POST /auth/verify-email`.** It
  is mounted as a group, so a route added to the wrong group stops needing
  verification — silently, since it still works. `TestUnverifiedAccountIsGated`
  walks the list with an *admin* principal, because the gate is not a role check
  and must hold for the role that passes every other one.
- **Just-in-time provisioning creates *unverified* users** — that path includes
  the compensating case where the Prelude account exists but the local insert
  failed, and those people never verified. The cost is that a database restored
  from a backup older than an account re-gates it; the recovery is the code on
  the verification screen. The migration backfills everyone who registered
  before verification existed, because they were never asked for a code.

The scope string lives in three places that cannot be made to share one: the
Prelude application config, `EmailVerifyScope` (Go), and `EMAIL_VERIFY_SCOPE`
(TypeScript). A mismatch reads as a challenge that completes and then verifies
nothing.

### Password reset

The emailed code is a **login**, not a token this app checks. Prelude opens
step-up challenges only on sessions that already exist (`/stepup/request` is
authenticated, and the docs say so outright), so a visitor who has forgotten
their password has nothing to step up from: proving the mailbox is what produces
the session, and a step-up on that session is what permits the password write.
Everything below follows from that one fact, and none of it announces itself.

- **The visitor is signed in from the code step onwards, so the reset screen must
  not send a signed-in visitor away.** The sign-in and sign-up screens redirect
  on `user`; copying that here ejects people one step short of the new password,
  leaving the account on the old one and a session opened by an emailed code.
  `VerificationGate` is the same trap from the other side — `/forgot-password` is
  in `UNVERIFIED_ROUTES` because an unverified account would otherwise be bounced
  mid-flow to a code form for a *different* challenge, which reads exactly like
  the reset code having stopped working. Both directions are pinned by tests.
- **`prld:pwd:write` is configured `status: continue`, which is what keeps the
  reset to one code** — a `review` here would email a second code proving the
  same mailbox. The cost is real and belongs to whoever adds a *signed-in* change
  password screen: with `continue`, any live session can acquire the scope, so a
  stolen session could change the password with nothing re-proven. That flow
  needs `review` + `verify_email`, not this entry. Flip this one and every reset
  dead-ends at the code form — `confirmPasswordResetCode` throws on any status but
  `continue`, and the code step shows its one uniform message. The real reason is
  in the console, which is the only place it can be.
- **A granted-outright scope refreshes nothing.** The SDK refreshes the session
  when a *challenge* completes; `continue` has no challenge, so the cached access
  token can still predate the grant and the password write answers 403.
  `canChangePassword()` is that forced refresh — it is not a redundant check, and
  removing it reintroduces a failure that looks like Prelude rejecting the
  password.
- **The step-up configuration is written with `PUT`.** `POST` answers
  `409 step_up_config_already_exists`, and the body replaces the whole config —
  so it must carry the `email:verify` entry too, or sign-up verification silently
  stops working for everyone.
- **Dispatch to an unknown address is a silent 204** that creates no user
  (observed live). That is what lets the screen advance to the code form for any
  address without leaking which ones are registered — so nothing may branch on
  that call. The leak then moves to the *code* step, where an address with no
  account necessarily fails: every failure there renders one string, and the
  cause goes to `console.error` instead. Uniform by construction, not by matching
  Prelude's error names — `isBadCode` would have leaked the moment an unknown
  account produced anything but `BadCheckCodeError`, which was never observed
  either way. The cost is that a genuine fault also reads as a wrong code, which
  is the same trade `LoginPage` makes for credentials.
- **"Send another" is the second place the same leak can reappear**, and it is
  not a message this time. Only an address with a dispatch in flight has anything
  to retry, so `retryOTP` failing for the others would answer what the email step
  refused to — and so would a cooldown that never started, or a code field left
  filled. Every observable of that handler is therefore identical whichever way
  the call goes, cause to `console.error`; the same trade buys the same cost, a
  genuine fault reading as a code on its way that never arrives.
- **A failure *after* `checkOTP` succeeded ends the session.** By then the
  visitor is signed in and the code is spent — the SDK drops the verification it
  was checked against — so neither retyping the code nor asking for another can
  revive the attempt. Left alone, the screen says the code was wrong while a live
  session opened by that code sits behind it, and the advice it offers cannot
  work. `confirmPasswordResetCode` therefore signs out before rethrowing, in a
  nested `try` so a failed revocation cannot replace the cause the page logs.
- **The grant lasts 300 seconds, and the password form can outlive it.** A
  visitor who takes longer than that gets `ForbiddenError` from `changePassword`
  with nothing whatsoever wrong with the password — reported as "try another" it
  is advice no password satisfies. The page names that one case and offers the way
  out ("Start again with a new code"), which is also why the password step has an
  exit at all: the steps are state, not routes, so the back button is not one.
- **A missing `VITE_PRELUDE_OTP_LOGIN_CONFIG_ID` is reported, not hidden.**
  `errorMessage` only carries through our API's own messages, so an unnamed
  `Error` would render as "we could not send a code" and send whoever reads it
  hunting a Prelude outage. The provider throws with
  `RESET_UNCONFIGURED_ERROR` as its `name` and the page matches on it, the way it
  already matches `BadCheckCodeError`. The constant lives in `auth/context.ts`
  because the page must not import `auth/session` — that module builds the SDK
  client at import time, which is what keeps the auth screens testable.

Never confirmed end to end: a correct code through to a written password. It
needs a mailbox someone can read, exactly like email verification.

### Frontend

- **`BrowsePage`'s debounced-search effect needs its guard.** `setParams` is not
  referentially stable, so the effect re-runs after *any* param write; without
  the guard it clears `page` every time and pagination cannot advance. The
  failure is silent — the button works, the same rows return.
- **Song pages link credits to `/?person=<id>`.** Browse must read that param,
  or clicking an artist lands on the unfiltered catalog with no error, reading
  as "this artist is on every song".
- **The token provider is registered at import time by `auth/session`, and must
  stay there.** React flushes child effects before parent ones, so a query
  mounted under `AuthProvider` starts fetching before any effect of the
  provider's has run. Registering from an effect therefore loses the race with
  every query on the page: the request goes out with the module default, which
  returns no token, and is answered as a guest. `GET /lists/{id}` was the
  visible case — a private list returning **404 to its own owner** on every page
  load, and nothing recovers, because `apiFetch` retries a 401 with a fresh
  token and this is deliberately not a 401. `session.test.ts` pins it by
  importing the module with no React in sight. The unauthorized *handler* stays
  in an effect on purpose: it needs React state, and no response can 401 before
  the first effects have flushed.
- **`useList`'s `ready` flag is belt-and-braces now, but the skeleton beside it
  is not.** The flag was the first fix for that 404 — gate the query until
  `useAuth().loading` clears — and it is redundant since the provider moved to
  import time, because the request carries a token either way. What still bites
  is the trap next to it: a disabled query is not `isLoading`, so
  `ListDetailPage` has to hold its own skeleton while waiting, or it falls
  through to "not available" and tells the owner their list is gone.
- **The verification gate wraps `<Routes>` and reads `user.email_verified_at`;
  `VerifyEmailPage` waits for `loading` before deciding, and its
  challenge-opening effect checks the same flag itself.** Three separate traps.
  The gate deliberately does *not* wait for `loading` — `user` is null while the
  session restores, which is the guest case, and blocking there would put a
  spinner in front of every visitor's first paint. The page is the opposite: it
  is reached by redirect and stays in the address bar, so deciding before the
  session is restored turns a refresh into a bounce to `/login`. And the effect
  needs its own check because hooks run before the redirects below them are
  rendered — without it, a visitor who is already verified opens a challenge and
  is emailed a code on their way past.
- **A list's rows are built by `SongRow`, whichever way the list is rendered.**
  `ListDetailPage` serves the sortable list only to an owner with more than one
  song; a list of one, every reader, and the wait for the drag chunk fall
  through to the plain one. A per-row affordance wired into the sortable list
  alone therefore reaches neither — which for removal meant the last song in a
  list could not be taken out of it, visibly, but only ever on a list of one.
  Add controls to `SongRow` and every rendering gets them. The drag handle is
  passed in already rendered, which is what keeps dnd-kit inside the lazy chunk
  while the row itself stays shared.
- **The list drag handle needs `touch-none`, and must be the only drag
  activator.** Both halves fail silently, and only on a phone. Without
  `touch-none` the browser keeps the gesture for scrolling and the row simply
  never moves; make the whole row draggable instead and the page loses its
  scroll gesture, so a long list becomes unreadable. Neither shows up on a
  desktop, where a mouse has no such conflict. `SortableSongList` is pinned by a
  keyboard-driven test, which is also the only way to drive dnd-kit in jsdom —
  see `src/test/rects.ts` for why the rows need stubbed rectangles.
- **The phone's way through a list is a swipe, and it is deliberately not a tap
  target.** Two versions of it were: invisible strips down the edges of the
  viewport, then down the edges of the lyrics, standing in for previous and next.
  A strip takes every press in the box it is given, so every control inside that
  box had to be lifted clear of it by hand — an allowlist, and so a thing that
  had to be right in two places at once. It was wrong twice, both times only on a
  phone: a near miss became a navigation (the gap between two buttons, the few
  pixels under Back), and a strip could take a slightly-off tap on a small
  control outright, because touch adjustment weighs every clickable candidate
  under the contact patch rather than the one point beneath its center. Neither
  reproduces by hit-testing single points in a desktop browser, which is why both
  looked fixed. A swipe cannot fail that way — 60px of travel is not something a
  press is mistaken for — so nothing is laid over the page and there is no
  allowlist to keep. **Do not reintroduce an invisible target here.**
- **The swipe must start clear of both screen edges, and `lib/swipe.ts` is where
  that number lives.** The edges belong to the browser: back and forward in
  Safari, the system's back gesture on Android. Read there as well, one movement
  would page the list *and* leave the page. The other rule in that module is that
  the gesture must be decidedly horizontal, since reading a song is the same
  gesture with the axes swapped. Both numbers are pinned **from both sides** —
  a guard narrower than the browser's own edge zone or wider than a thumb, an
  axis rule loose enough to read a diagonal drag or tight enough to refuse a real
  swipe, each fail a spec. That is deliberate and worth keeping: with only the
  cases either side of the line, the edge guard could quietly shrink from 44 to
  13 with the whole suite green.
- **Every touch listener is passive and nothing calls `preventDefault`.** The
  gesture is read after the movement rather than taken from it, which is what
  leaves a long song's vertical scroll alone — the failure `touch-none` would
  cause, inverting the drag handle's rule above, and invisible on a desktop where
  a mouse has no such conflict. The gesture is also claimed or dropped at the
  moment the finger goes down, which is where all four of its guards live: one
  finger only, clear of the edges, no open sheet, and not starting on a control.
  "A sheet is open" is `lib/modal.ts` — one question for the swipe and the arrow
  keys both, asked of the DOM rather than of a page, so the next sheet is covered
  without being added to a list. `Sheet` is the only writer of the pair of
  attributes it looks for, and says so where it writes them; a move to `<dialog>`
  and `showModal()` has to be answered there. That last one is belt
  and braces and deliberately the safe way round — a swipe over a control does
  nothing, rather than a control being unreachable under the gesture, which is
  precisely how the strips went wrong.
- **The mark that says the swipe is there is shown once per device, and waits to
  be on screen before spending it.** It is the only visible sign of the gesture,
  so the timing is the whole of it, and `useSwipeHint` asks an
  IntersectionObserver rather than a timer for one reason: `md:hidden` gives the
  mark no box at a desk, a hidden element never intersects, and so the single
  showing is not spent on a machine with no gesture to explain — most of all on
  the machines that are both, where a tablet in landscape spends nothing and has
  the mark waiting when it is turned. **Keep `md:hidden` on the observed box, not
  on the pill inside it**: moved in, it still hides the mark, but the box keeps
  its box, so the observer fires at a desk and spends the showing where nobody
  can see it. Keep the mark `fixed` too — that is what makes "on screen" and "on
  a phone" the same question, with nothing to scroll to. Past that showing the
  mark is not rendered at all, rather than left invisible over the page, which is
  the shape of thing the strips were. The key is `lyrics:swipe-hint-seen` — the strips' key was already spent on real
  devices, so reusing it would have meant nobody who saw the old hint ever learned
  the new gesture. jsdom has no IntersectionObserver: `src/test/intersection.ts`
  is a stub that answers back, so a spec can say the mark has come into view.
- **A song reached from a list carries `?list=<id>`, and every step keeps it.**
  Dropped anywhere along the way, the next song is a dead end: the page still
  renders, the reader is simply out of the list with nothing saying so. Which is
  why `lib/listContext.ts` builds every destination — a `ListPosition` hands the
  navigation steps that already carry their `href`, so no component below it can
  forget the parameter, and only `SongCard` (whose row passes `listId`) composes
  one itself. Steps are **pushed, not replaced**: the back gesture — and
  `BackButton`, which is the same thing — walks back through the songs a reader
  came through and reaches the list at the end of them. Replacing instead would
  collapse the trail to one entry and send the first press to the list, which is
  the same two controls behaving differently; the list's name in the bar is the
  press that skips the trail.

---

## Decisions worth not reversing

- **Roles live in our Postgres, not in Prelude claims.** A promotion applies on
  the next request instead of the next token refresh. Prelude supports custom
  claims; using them here would make role changes lag by a token lifetime.
- **Whether an address is verified lives in our Postgres**, like roles, because
  Prelude exposes no verified flag on an identifier: `users.email_verified_at`
  is the record. Nothing about the challenge itself is stored — it belongs to
  the browser's session with Prelude.
- **Registration goes through our backend.** The browser SDK can only *log in* —
  creating a user is a Management API call needing the API key, which must never
  reach a browser. `POST /auth/register` makes two upstream calls and **deletes
  the account if the second fails**: a user created without a password can
  neither sign in nor register again, permanently burning that address.
- **Queries are hand-written against pgx, not generated.** Most of the surface is
  dynamic — composable filters, blended relevance ranking — which generators
  model poorly.
- **Handlers return errors**; `httpx.Handler` renders them. The response envelope
  is consistent by construction rather than by convention.
- **`created_by` is nullable.** Catalog content outlives the account that entered
  it, so deleting a user leaves their songs in place.
- **Credit filters are `EXISTS` subqueries, not joins.** A join multiplies a song
  by its matching credits, and two credit filters then union instead of
  intersecting.

---

## Conventions

- **PATCH is tri-state.** `optionalString`/`optionalBool` distinguish absent
  (leave alone) from explicit null (clear). A plain `*string` passed through to
  the store blanks every omitted field on `PATCH {}`.
- **Style modules over co-exports.** `buttonStyles.ts`, `fieldStyles.ts`,
  `lib/snippet.ts`, `lib/credits.ts`, `lib/theme.ts`, `auth/context.ts` exist so
  component files export *only* components — that is what keeps fast refresh
  working, and eslint enforces it.
- **`cn()` is a plain join, not tailwind-merge.** Later classes do not override
  earlier ones; share the chrome rather than passing overrides through.
- **Filter state lives in the URL**, so a filtered search is shareable and the
  back button behaves.
- Frontend permission checks (`hasRole`, `canEditSong` in `lib/types.ts`) decide
  what to *render* only — the server is the authority and enforces every rule
  independently. They are shared rather than inlined so an affordance and the
  guard behind it cannot disagree about who gets in.

---

## Testing

- **Backend integration tests need a real PostgreSQL** — the generated search
  vector, denormalization triggers, `ts_headline` and trigram ranking all live in
  the database and cannot be faked. Each test binary creates **its own database**
  (`lyrics_test_<binary>`): `go test ./...` runs packages in parallel, and a
  shared database means one package truncates another's fixtures mid-test.
- Override with `TEST_DATABASE_URL`. Tests skip (not fail) when nothing is
  reachable, which is why `make test-backend` starts the database first.
- **Token verification is tested against a locally generated key set** served by
  `httptest` (`testutil.TokenIssuer`) — the only way to produce expired,
  wrong-issuer, foreign-key and `alg: none` tokens on demand. `PRELUDE_JWKS_URL`
  and `PRELUDE_ISSUER` point the app at it.
- Frontend uses vitest + RTL + MSW, with `onUnhandledRequest: "error"` — an
  unstubbed request is a bug in the test, not something to pass through.
- `renderWithProviders` stubs the auth context rather than mounting the real
  provider, so tests never touch the Prelude SDK.
- Playwright's guest specs need only a running seeded stack. The signed-in spec
  cannot be stubbed (the SDK talks to Prelude directly) and skips unless
  `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` are set.

---

## Data

- `make seed` loads a small Greek + English catalog — enough for search ranking,
  diacritic folding and credit filters to be observable immediately.
- **Importing the old catalog** (previous TypeORM/PG14 database):

  ```bash
  OLD_DATABASE_URL=postgres://... make migrate-catalog ARGS=--dry-run
  make import-songs FILE=songs.ndjson ARGS=-dry-run   # reload an existing export
  ```

  Export and load are two stages on purpose: the NDJSON is the only artifact
  that survives a failed load, and the old database sits behind a
  trusted-sources firewall that may not be open on a second attempt. The load
  runs in one transaction and is re-runnable — a song already present (matched
  on normalized title plus its credited people) is skipped, since `songs` has no
  unique constraint to lean on. Always start with the dry run.

---

## Environment

- `.env` is **gitignored and holds live Prelude credentials**. Never copy secrets
  into tracked files, and note that the recursive `grep` here is gitignore-aware,
  so it will silently skip `.env` when scanning.
- The Management API key is server-side only. `VITE_PRELUDE_SDK_KEY` is a
  publishable client identifier and is safe in the bundle.
- Vite only exposes `VITE_`-prefixed variables; `make web` maps `PRELUDE_APP_ID`
  and `PRELUDE_OTP_LOGIN_CONFIG_ID` across rather than keeping a second copy in
  `.env`. **Every mapping exists in four places** — `make web`, `make mobile`,
  `docker-compose.yml` (whose build args must match `web/Dockerfile`'s `ARG`/`ENV`
  pair) and `scripts/deploy-do.sh` — and a new variable is easy to add to only
  some of them. Only the deploy script complains: the others build happily with
  an empty value, so the failure is a screen that reports itself unconfigured on
  one stack while working on another.
- The Makefile reads `.env` from the directory it runs in, and a **git worktree
  has none** — so `make web` there serves a build with every Prelude variable
  empty. Sign-in and password reset then fail in ways that look like bugs in the
  code being tested. Run the dev server with the values exported from the main
  checkout's `.env`.
- `ADMIN_EMAILS` applies **only at provisioning**. Adding an address later does
  not promote an existing account — change `users.role` directly, or use
  Admin → Users.

---

## Deployment

`.do/app.yaml` is the App Platform spec; `scripts/deploy-do.sh` applies it,
substituting the placeholder env values from `.env` so no credential lands in a
tracked file. Four components: a static site at `/`, the API at `/api`, a
pre-deploy migration job, and a managed PostgreSQL. README has the walkthrough;
these three are the parts that break quietly.

- **The `/api` ingress rule needs `preserve_path_prefix: true`.** App Platform
  strips a matched prefix by default, and the router mounts at `/api/v1` — so
  without it every request arrives as `/v1/…` and the app answers "No such
  endpoint" to a frontend that looks correctly configured. (The old `squid-app`
  spec omits it because its backend did not carry the prefix. Do not copy it.)
- **The backend image must keep `CMD` rather than `ENTRYPOINT`.** `run_command`
  replaces a component's command, and with an `ENTRYPOINT` in place it may be
  appended to it as arguments instead — in which case the migration job starts a
  second API and hangs until the deploy times out rather than migrating. With no
  `ENTRYPOINT` the question does not arise, which is the only reason the image
  gives one up.
- **A production frontend build must leave `VITE_API_BASE_URL` unset**, which
  makes it call its own origin. Vite inlines the value at build time, so setting
  it bakes in a hostname that a domain change then invalidates — and the failure
  appears only in the browser, long after a green deploy.

Migrations run from `cmd/migrate`, which embeds `backend/migrations` with
`go:embed` (hence `migrations/embed.go` — the directive cannot reach upward).
The tests still read the same files from disk, so editing SQL takes effect
without a rebuild. The API deliberately still does not migrate on boot.
