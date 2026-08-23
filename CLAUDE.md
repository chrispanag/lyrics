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

### Recordings

A song has 0..n **recordings** (εκτελέσεις): one performance each, with its own
performers, YouTube link, year, label and notes. Migration 000009 split them out
of the song, and the parts below are what hold that split up.

- **The song still carries `youtube_url`, `youtube_video_id` and
  `release_year`, and they are denormalized copies of the *first* recording's.**
  Trigger-maintained, exactly like `credits_text` — which is what let browse's
  year filters, the catalog sort and `SongCard`'s video badge survive the split
  with no query touched at all. **Nothing but the trigger may write them.** They
  are absent from `SongInput`, from the `INSERT`/`UPDATE` in `CreateSong` and
  `UpdateSong`, and from the importer's insert; a second writer is how a
  denormalized column comes to disagree with what it was copied from, and here
  the disagreement is a year on the page belonging to a recording other than the
  one shown beside it. Deleting a song's last recording therefore nulls all
  three, which is the truth about it. **`SongDetailPage` reads the year and the
  video off these columns too, and not off `recordings[0]` hedged against
  them.** The hedge looks like the safe form and is the opposite: its right-hand
  side is unreachable — the columns *are* the trigger's copy of the row index 0
  is, which `TestFirstRecordingRuleHasOneAuthority` is what pins — so it asks
  the reader to reason about a disagreement the schema forbids, and it would
  paper over exactly the one that test exists to surface. Reading the same
  column `SongCard`'s badge reads is what makes the card and the page agree
  structurally; the first recording is still where the *performers* come from,
  since those are on no column.
- **"First" is one ORDER BY, and it exists in exactly two places that cannot
  share an implementation** — the recordings query in `attachRelations` and the
  sub-SELECT inside `refresh_songs_denorm`. The first hands clients an
  already-ordered list so nothing re-derives the rule (`recordings[0]` *is* the
  first recording); the second picks the row whose year and link are copied onto
  the song. Disagreeing, they put a year in the header that belongs to a
  different recording than the performers beside it. Both are commented at each
  other and `TestFirstRecordingRuleHasOneAuthority` asserts them against one
  another — including the case that catches it, unmarking the marked recording
  so first place moves to another row.
- **`is_first` is a claim about history, not a position.** It may be false on
  every recording of a song, which is why the order falls back to the earliest
  year and then to `position`, and why at most one may be true — a partial
  unique index, since the rule spans rows and a CHECK would pass every second
  `true`. The API refuses two with a 422 naming the field the radio group
  writes; the index is the backstop under it. The sheet's **"First recording"
  badge keys on the flag and never on index 0**: order is something the list
  always has, and badging index 0 asserts a claim nobody made.
- **`?person=` has to ask both tables.** It is the role-agnostic filter every
  name on a song page links to, so missing the recording arm reads as an artist
  being on no songs — the same shape as the `?person=` trap under Frontend, one
  step deeper. `?artist=` is kept as an alias of the honest `?performer=`
  because those links are bookmarked and shared, and asking for both at once is
  a 400 rather than a precedence nobody stated.
- **`credits_text` unions both sources, and the union is what keeps fuzzy artist
  search working.** Performers are most of what anyone searches a song by. Left
  out, a song stays findable by its composer and not by the singer it is known
  for — and `TestFuzzyArtistMatchSurvivesManyCredits`, whose extra names are now
  performers, is the test that would notice. `songs_denorm_from_person_rename`
  needs the same widening: reading `song_credits` alone, correcting a singer's
  spelling silently makes them findable under neither. `UNION`, not `UNION ALL`,
  because someone who wrote a song and also performed it is one name.
- **`people.song_count` and the delete guard span both tables too.** The count
  is a `UNION` so a song counts once for a person who wrote *and* performed it,
  and `recording_credits.person_id` is `ON DELETE RESTRICT` like its
  counterpart — which needed no Go change, since it raises the violation
  `execExpectingRow` already maps to `ErrInUse`.
- **The importer synthesizes a first recording, and must keep matching what the
  migration did.** `artist` and the performing vocabulary now route to a
  recording's performers rather than to a credit role; `fallbackRole` is
  `classPerformer`, because an unrecognized label is far likelier to name a
  performance than to claim authorship. **Performers count towards the
  fingerprint** — they are the same people who used to arrive as `artist`
  credits, so leaving them out gives a re-import of the same export a different
  fingerprint from the migrated row and duplicates the whole catalog.
  `loadFingerprints` reads the union for that reason.
- **The stored-unparseable-link exemption is matched by URL string, not by
  recording id.** `replaceRelations` replaces recordings wholesale, so ids do
  not survive a write and there is nothing durable to key on; the string is
  exactly the "unchanged from what is stored" test the exemption turns on. The
  editor hydrates such a link verbatim and resends it, and the preview simply
  stays dark — it is confirmation, never a gate. Pinned from three sides in
  `TestPatchKeepsAnUnparseableStoredYouTubeURL`, including that a create is
  never exempted.
- **A recording with no performers is the common case, not an edge.** Of the
  ~910 the migration created from the live catalog, ~890 carry a year and
  nobody's name. So the song page's "Performed by" row is conditional, and a
  sheet row falls back to its label and then to its year rather than rendering
  an empty line above a watch button.
- **`extractVideoId` lives in `web/src/lib/youtube.ts`** now that a link is
  previewed per recording. It is still the deliberate mirror of Go's
  `parseYouTubeURL` that its own doc describes — a copy per call site would be a
  copy per call site to keep in step with the server.

### Song addresses

A song is addressed by `songs.slug` — `/songs/to-tragoydi-tis-agapis` — and the
UUID form still resolves, permanently. Migration 000010 added the column, and the
parts below are what hold it up — none of which announces itself when broken.
(Deliberately not counted, for the reason Profile pictures gives: a number in
prose is this file's inventory going stale.)

- **The slug is written by a `BEFORE INSERT` trigger and by nothing else, and
  never on `UPDATE`.** That is what makes "frozen through a retitle" structural
  rather than a rule each writer has to remember — the promise `UpdateGenre`
  keeps by hand for a genre's slug, kept here by there being no
  `UPDATE songs SET slug` to forget. `CreateSong`, `UpdateSong` and the
  importer's own `INSERT` therefore needed no change at all, the importer
  included, and it bypasses the store. The one thing the trigger honors is a
  slug that arrived with the row: that is a restored dump, and recomputing would
  break the links the dump exists to preserve. Nothing in the API can reach that
  path — neither `SongInput` nor `songRequest` has the field, and `DecodeJSON`
  refuses unknown ones.
- **`app_slugify` (SQL) is a deliberate mirror of `store.Slugify` (Go)**, like
  `app_norm` against the `app_simple` configuration and `extractVideoId` against
  `parseYouTubeURL`. It exists because the backfill has to run inside the
  migration, and because Greek transliterates rather than folds: without the map
  "Έντεχνο" strips to "Εντεχνο" and slugifies to nothing, so most of this catalog
  would have no address. `TestSongSlugMatchesSlugify` runs inputs through both
  and asserts they agree — it compares the two implementations rather than
  either against expected strings, so the table only has to cover where they
  could diverge. One class of divergence is known and left open: `unaccent`
  expands a few Latin characters that Go only strips, so "Straße" is `strasse`
  in SQL and `stra-e` in Go. Nothing in this catalog reaches it, and it is
  deliberately not in the table — adding a case without reconciling the two
  turns the suite red, and reconciling means either chasing `unaccent.rules`
  from Go or changing how a *genre's* slug is derived, which is a decision of
  its own.
- **Two slugs are refused, for reasons that have nothing to do with how they
  read.** `new` is the editor's own address and both routers rank a static
  segment above a dynamic one, so a song slugged `new` would be permanently
  unreachable with its URL opening a blank editor. And a UUID-shaped slug would
  be shadowed by the resolver, which parses a UUID before it tries a slug — the
  CHECK regex happily accepts one. That is **two** spellings and not one, since
  `uuid.Parse` also takes the 32 hex digits with the dashes left out, which is
  the form a reservation written from the canonical one misses and the form a
  title could actually produce, needing no punctuation to survive slugification.
  Both are suffixed instead, which is also what
  a collision gets: titles are not unique here and were never meant to be (the
  importer counts seven groups sharing one), so `-2` is the ordinary case rather
  than an edge one. A title that slugifies to nothing at all gets `song`.
  Concurrent inserts of one title would otherwise both read the same free suffix
  and one would lose on the unique index — reported as "Song already exists.",
  wrong advice for two songs legitimately sharing a title — so the trigger takes
  a transaction-scoped advisory lock on the base slug.
- **The backfill and the trigger call one function, and it can only be written
  a row at a time.** The set-wise form is the one that suggests itself and is
  wrong: numbering within a title's own group hands `o-chorismos` and
  `o-chorismos-2` to two songs called "Ο χωρισμός" and then hands
  `o-chorismos-2` to a song called "Ο χωρισμός 2" as its *unsuffixed* base. What
  that costs is not a bad address but a migration that will not apply —
  `CREATE UNIQUE INDEX` aborts on a catalog that looks perfectly ordinary, and
  the deploy stops with the version marked dirty. `app_song_free_slug` asks the
  table for each row in turn, which is the only form that cannot do it, and
  being one function is what keeps the two paths from drifting apart again.
  `songs_set_updated_at` is switched off around the backfill for a smaller
  reason with no second chance either: every song is written, so left on, the
  migration stamps the whole catalog with the moment it ran.
- **An unknown address is 404, not 400.** `urlUUID` answered 400 because a
  segment that did not parse could only be a malformed identifier; once a slug is
  a legal address it means "no such song", and nothing can tell a mistyped slug
  from a deleted one. **Two resolvers, and which one a handler takes is a real
  choice**: `songRef` returns the song, for `GET` and `PATCH`, which need the
  record anyway; `songID` returns the identity and nothing else, for the
  handlers that only ever read `.ID` — `handleDeleteSong`,
  `handleListsContainingSong`, and the two ways a song moves in and out of a
  list. Reaching those through `songRef` costs the lyrics body plus
  the four queries `attachRelations` runs, thrown away to keep sixteen bytes.
  `songID` also returns a well-formed UUID *unlooked-up*, which is what keeps
  those handlers answering as they always did — their own store calls map a
  missing row onto `ErrNotFound`, and asking first would turn
  `GET /songs/{unknown-uuid}/lists` from the empty list it has always answered
  into a 404. **Every route whose path names a song has to take both forms**, and
  the two under `/lists/{id}/songs/{songID}` are the ones that were missed the
  first time: they kept `urlUUID` while the app started sending slugs, so saving
  a song to a list answered 400 on every address the app itself builds. Nothing
  structural prevents that — no type separates a ref from an id — so
  `TestASongAnswersAtItsSlugAndItsID` is what stands in for it, and the subtest
  that walks a song in and out of a list is the half that catches it.
- **The frontend asks `songMatchesRef`, never `song.slug === ref`.** An old
  `/songs/<uuid>?list=<id>` link still resolves, is still shared, and **nothing
  canonicalizes it** — there is no redirect from the id form to the slug, on a
  document load or anywhere else. `listPosition` matching the slug alone
  therefore leaves every reader holding an old link on a song page with no list
  bar, no swipe and no arrow keys, and nothing saying why. `SongSearch`'s "is
  this the song already open" test has the same shape, where getting it wrong
  pushes the duplicate history entry that test exists to
  prevent. `lib/listContext.ts` owns the address in **both** directions —
  `songHref` builds one and `songRefFromPath` reads one — because a pathname
  parsed anywhere else is `/songs/` written in a second place, and only the first
  gets found when it changes. `useUpdateSong` writes the fresh song under the ref
  the URL held and only that one: a song has two addresses but a page asked
  under one of them, nothing navigates between the forms in-app, and a second
  entry would hold a whole song, lyrics included, that nothing ever reads.

### Genres

- **`genres.name` is unique, and that index is the only thing holding it.** The
  slug is unique too and every path that *creates* a genre derives the slug from
  the name, so two genres named alike collide there — but `UpdateGenre` leaves
  the slug alone on purpose, so bookmarked filter links keep working, and that
  is exactly what let a rename walk one genre onto another's name. The result
  reads as a display bug and is not one: two identical chips in the browse
  filter, two identical options in the song editor, and no way to tell which
  songs are behind which. Folding stays with the slug, which is the folded
  identity already; the index only has to stop two rows displaying the same
  string. Pinned by `TestRenamingGenreOntoAnotherIsRefused`. **`songs.slug` is
  the same rule with a different enforcement**, and the difference is worth
  knowing: a genre's slug is derived in Go, at each path that creates one, and
  left alone by `UpdateGenre` because that function says so — a song's is derived
  in SQL by a trigger that only runs on insert, so there is no update path to
  leave anything alone. See "Song addresses" above for why that trade was taken;
  it is the reason two entities in this schema slugify in two places.
- **A rename or a delete has to unsettle four query keys, and the easy one to
  forget is `["list"]`.** A song carries its genres inside its own payload and
  `SongCard` renders them, so a renamed genre keeps its old name on every cached
  song page, song row and list page — and after a delete, a label the genre no
  longer has. A genre is nowhere named on a list, which is why that key goes
  missing: it is two hops down, in `songs[].genres`. Creating one needs none of
  this, since a new genre is on no songs, and that asymmetry is the whole reason
  `invalidateGenres` is written down beside `invalidateGenreList`.
- **`invalidateSongs` is the same shape from the other direction**, and the same
  key is the one it exists for: editing a song has to unsettle `["list"]`,
  because a list caches the songs on it and `SongRow` renders them through
  `SongCard` — whose byline is built from `recordings[0].performers`, two hops
  down in `songs[].recordings`. Creating a song needs none of it, being on no
  list yet; the asymmetry is stated in the helper rather than per hook, since
  that is how one half of it comes to be forgotten. A delete also stales
  `["lists"]`'s item counts, which is a gap predating recordings and is left
  named rather than fixed as a side effect.

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
  reaches the frontend build as `NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN` to become the SDK's
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
- **The reset asks for two codes, and the second one is not its own idea.**
  `prld:pwd:write` is configured `review` + `verify_email`, so Prelude emails a
  code before granting the scope — proving, seconds later, the same mailbox the
  login code just proved. Nothing about the reset wants that. There is one
  step-up configuration with one entry per scope, and `requestStepUp` names a
  scope and nothing else, so the entry belongs to the strictest flow that uses
  it: [changing a password while signed in](#changing-a-password-while-signed-in),
  which has no proof available to it but a code. The reset pays, being the flow
  that has proof to spare.
- **Both statuses are handled, in the flow that does not need the strict one.**
  `confirmPasswordResetCode` answers `{ secondCodeSent }`, and `continue` — the
  scope granted outright, nothing emailed — takes the visitor straight to the
  password step, which is what the reset did when that was the configuration. So
  the entry can be flipped either way with no deploy behind it and no window
  where reset is broken; what flipping costs is visible on the other screen,
  which then refuses itself. An earlier version threw on anything but
  `continue`, which is why this is written down: the same code, read as an
  invariant rather than a branch, dead-ends every reset at the code form behind
  one uniform message, with the real cause in the console.
- **A granted-outright scope refreshes nothing.** The SDK refreshes the session
  when a *challenge* completes; `continue` has no challenge, so the cached access
  token can still predate the grant and the password write answers 403.
  `canChangePassword()` is that forced refresh — it is not a redundant check, and
  removing it reintroduces a failure that looks like Prelude rejecting the
  password. It is called on the code path too, where the SDK has refreshed
  already: the check is what makes "the code bought no permission" a failure the
  code step can name, rather than an opaque rejection of a good password a step
  later.
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
- **A missing `NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID` is reported, not hidden.**
  `errorMessage` only carries through our API's own messages, so an unnamed
  `Error` would render as "we could not send a code" and send whoever reads it
  hunting a Prelude outage. The provider throws with
  `RESET_UNCONFIGURED_ERROR` as its `name` and the page matches on it, the way it
  already matches `BadCheckCodeError`. The constant lives in `auth/context.ts`
  because the page must not import `auth/session` — that module builds the SDK
  client at import time, which is what keeps the auth screens testable.

Never confirmed end to end: a correct code through to a written password. It
needs a mailbox someone can read, exactly like email verification.

### Changing a password while signed in

`/change-password` runs the same step-up the reset ends with, and the emailed
code is the whole of its proof. That is not a choice between two options: this
screen has nothing to offer Prelude but the session that asked, which is exactly
what a stolen session is, so the code is the only thing in the flow that a thief
would not also have. Everything below follows from having no second factor to
lean on.

- **There is deliberately no "current password" field.** Nothing in the browser
  can check one — `validatePassword` judges composition rules, not the account's
  actual password — and Prelude's password step-up has no step that does, so the
  only way to verify one would be to sign in again with it: rate-limited at
  10/hour per identifier and shared with ordinary sign-in, so a few fumbles lock
  the visitor out of the app as well as the form. What is left is a field checked
  by nobody, which an attacker skips by calling the SDK directly. A field like
  that is worse than none: it reads, to everyone including the next person to
  work on this, as though something were being verified.
- **The screen refuses a `continue` grant instead of proceeding.**
  `startPasswordChange` throws `PASSWORD_CHANGE_UNAVAILABLE_ERROR` when Prelude
  hands over `prld:pwd:write` with no challenge, and the page renders that as its
  own state — pointing at the reset, which proves the same mailbox. Proceeding
  would leave a screen that changes a password on the strength of the session
  that asked to change it: the exact hole it exists to close, now with a
  confirmation step in front of it. Refusing does not un-grant the scope, and is
  not meant to; the *configuration* is the enforcement, and the refusal is how a
  configuration that stopped enforcing announces itself instead of going quiet.
- **One challenge ref per scope.** The verification and password challenges are
  tracked separately, and both guards read as "a challenge of mine is already
  open" — which is what keeps a remount from retiring the code already in the
  inbox. Share one ref and each flow reuses the other's: no challenge of its own
  is opened, and its code is checked against a challenge for a scope it never
  asked about.
- **The resend has to be able to open a *fresh* challenge.** A challenge expires
  in ten minutes, a visitor who wandered off comes back to a page still naming
  it, and `retryOTP` on a dead challenge fails for good — so every later attempt
  fails identically and the screen has no way out of a state it cannot describe.
  `resendPasswordChangeCode` drops the ref and opens a new one when the retry
  fails, which also covers a first attempt that never opened one at all. The
  swallowed cause goes to the console, because a Prelude outage looks identical
  from here.
- **The grant lasts 300 seconds and the password form outlives it**, exactly as
  on the reset screen, and with the same consequence: `ForbiddenError` with
  nothing whatsoever wrong with the password. It is named, and "Start again with
  a new code" asks for a *new* code rather than stepping back to the old form —
  the challenge that got here is spent, so a form waiting on it could not be
  satisfied.
- **The route is guarded by `RequireAuth` and sits outside the shell**, beside
  the other credential screens rather than inside `Layout`. The steps are state,
  not routes, so navigation offered beside them is the flow lost part-way
  through. It is deliberately *not* in `UNVERIFIED_ROUTES`: an unverified account
  is bounced to the verification screen, which is the right screen — the address
  has to be proven before a code sent to it can prove anything else.
- **Failures here can be named, unlike the reset's.** Enumeration is what forces
  the reset's one uniform message, and there is nothing to enumerate on a screen
  only reachable by a signed-in account looking at its own profile. The reset's
  *second* code step is the same case for the same reason, being reachable only
  after a correct first code — which is why that step names a wrong code while
  the step before it must not.

Never confirmed end to end, exactly like the reset: a real code through to a
written password needs a mailbox someone can read.

### Profile pictures

Prelude has no picture field — a user's `profile` there is an open map of string
values, and nothing in the product hosts an image — so the picture is ours, like
`users.role` and `users.email_verified_at`. The parts below hold it up, and none
of them announces itself. (Deliberately not counted: the count was seven, the
list was ten before this sentence was written, and a number in prose is the
inventory this file records going stale under Head assets.)

- **`GET /users/{id}/avatar` is public, and has to be.** An `<img>` is not
  fetched by `apiFetch` and carries no bearer token, so a picture behind
  authentication does not load for the person it belongs to — the same failure
  as the private-list 404 below, and nothing recovers from it either. The cost
  is accepted: avatars are public content keyed by an unguessable identifier.
  Which is why a missing picture and an unknown user are the *same* 404 — the
  route must not answer whether an identifier belongs to an account.
- **The `user_avatars` row and `users.avatar_updated_at` are written in one
  transaction.** That timestamp is the only version the client is given: it is
  the ETag, and it is the `?v=` the app appends to an address that never
  otherwise changes. Written apart, every reader holds a URL pointing at a
  picture that has already been replaced, and holds it for the whole of the
  freshness window the `http.ServeContent` bullet below is about. The bytes live
  in their own table because `userColumns` is one string scanned by every `/me`,
  every provisioning and every page of the admin console; that table deliberately
  has no timestamp of its own to disagree with this one, which is also what keeps
  the `RETURNING userColumns` every user write uses — a joined column cannot
  appear there.
- **`image.DecodeConfig` runs before `image.Decode`.** A few kilobytes of PNG
  can declare 20000×20000, and decoding it allocates 1.6 GB before any check
  downstream of the decode could refuse it. Pinned with a hand-built 33-byte
  header, `testutil.PNGHeader`, which is a decompression bomb with no pixels in
  it at all.
- **`POST /me/avatar` is rate limited on the caller's *user id*, not on their
  address.** A decode and a re-encode is the most any single request in this API
  costs, and a signed-in account can ask for it in a loop as fast as the server
  answers — one request at a time, so nothing about the traffic looks like an
  attack. The route is authenticated, which is what makes the better key
  available: the id is proven by the token, where an address is whatever the
  network says — an office behind one NAT would share a bucket and be throttled
  together, and the address is also the part of a request a caller can vary to
  buy a fresh one. `DELETE` is deliberately outside the limit, being a row
  delete with no image work behind it, and somebody refused an upload must still
  be able to take down the picture they have. Pinned by
  `TestProfilePictureUploadsAreRateLimited`, which asserts the *route* — the
  counter itself is unit tested — and asserts a second account is unaffected,
  since sharing a bucket is the failure the key choice exists to prevent.
- **The upload is cropped, shrunk and re-encoded rather than stored.**
  Re-encoding is what strips EXIF — a photo from a phone carries the GPS
  coordinates where it was taken, which nobody choosing an avatar is thinking
  about — and it makes the stored bytes provably the output of Go's encoder
  rather than a file that merely begins with the right magic bytes. `Normalize`
  returns the content type *with* the bytes, so the label a row is stored under
  cannot disagree with the format that was encoded. Cropping belongs here
  rather than only in the browser because this is the layer no client can skip:
  "a stored picture is square" is then true for every consumer, and the
  `object-cover` on the `<img>` is belt and suspenders instead of the thing
  holding the circle together. Shrinking belongs here for the same reason and
  was missing: `Normalize` cropped without ever resizing, so a client that
  skipped `toSquareJpeg` could store a full `MaxDimension` square — sixteen
  times the pixels the app draws — and the admin console downloads fifty
  pictures to fill fifty 40px circles. `StoredEdge` is `AVATAR_SIZE` in
  `lib/image.ts`, one decision written in two places; the two disagreeing costs
  sharpness or upload bytes and never fails, because the smaller of them wins.
  It is emphatically **not** `MaxDimension`, which is the decode bound above —
  a refusal, sized to stop a header allocating 1.6 GB — and folding the two
  together either refuses ordinary photographs or stores them at four times the
  edge anything renders them at. JPEG has no alpha, so a transparent source is
  flattened onto white first; drawn straight across, every clear pixel comes
  out black and a logo on a clear background arrives as a dark square. That
  flatten asks the *image* whether it is opaque rather than checking `format ==
  "png"`: keyed on the format name, registering one more decoder — a line in an
  import block, in a file with no reason to mention compositing — would
  silently bring the black square back. The fill also goes down *before* the
  resample, and that order is load-bearing now that there is one: scaled with
  `draw.Src` instead, a transparent source writes premultiplied zeroes straight
  over the white and the dark square is back with an extra step in front of it.
- **The browser has to bake the rotation into the pixels before uploading.**
  `lib/image.ts` passes `imageOrientation: "from-image"` explicitly, because Go's
  decoder ignores EXIF and this re-encode discards it. Without it every portrait
  taken on a phone is stored on its side — and only photos from phones, so no
  synthetic test image reproduces it. A client bypassing `toSquareJpeg` can still
  store a sideways picture; that is bounded and accepted.
- **A `Blob` handed to `fetch` is only recognized by the implementation that
  defined it**, which is why `payloadOf` reads it out to an `ArrayBuffer`: an
  unrecognized Blob is *stringified*, so `"[object Blob]"` goes up as thirteen
  bytes of text with every byte of the image dropped, and the request looks
  perfectly well formed doing it. jsdom's Blob implements `slice`, `size` and
  `type` and nothing else, which is why `vitest.setup.ts` fills in
  `arrayBuffer` beside the other gaps it covers.
- **`Avatar` decides from `avatar_updated_at`, never from whether an image
  loaded** — the same idiom as `SongCard`'s badge reading `youtube_video_id`.
  Which is why both avatar mutations unsettle `["users"]`: the admin console
  caches its own copy of that field, so without it an admin who removes their
  picture finds their own row still rendering an image — the old one out of
  their own still-fresh cache, an empty circle on anybody else's machine.
- **The same component decides how eagerly a picture loads, and it reads that
  off `size`.** `lg` is a page's focal picture — the profile screen's own — so it
  loads eagerly while every other placement stays lazy. One unconditional
  `loading="lazy"` deferred the focal picture along with the rest, and the one
  image a reader came to look at then paints after the layout around it, so an
  upload that has already succeeded reads as not having taken. Nothing errors,
  and a fast machine never shows it.
- **Both controls that touch a picture live behind the pencil on the circle,
  and the sheet closes before either one starts work.** What that buys is where
  the state goes: the busy spinner is on the badge and the failure is on the
  page, so neither has anywhere else it could be. Left open, the sheet covers
  the picture being replaced — the one thing worth watching — and its file
  input is still there to start a second decode over the first, which is the
  race `preparing` exists to close. Closing is also what empties the input, so
  the pick's `event.target.value = ""` is belt to those suspenders rather than
  the load-bearing line it is on a form that keeps its input. The whole circle
  is the button rather than the badge, which at 32px is under the 44px floor
  the rest of the page keeps.
- **Three things follow from the sheet closing under its own action, and each
  is a hole where the arrangement it replaced had none.** The control that was
  pressed unmounts, so focus goes to `<body>` and a keyboard reader is returned
  to the top of the document — `Sheet` hands focus back to whatever opened it,
  which is written there rather than here because every one of its callers has
  the same gap and one of them will close the same way next. That handing-back
  is why **the pencil must not be `disabled` while busy**: focus cannot land on
  a disabled element, so the guard would eat the fix. Which in turn is why **the
  refusal of a second pick is stated inside the sheet** — `disabled` on the
  input and on Remove — rather than left to the trigger being unpressable, and
  the specs reopen it mid-upload to say so. And the spinner on the badge is
  `aria-hidden` inside a button whose name never changes, so the wait is
  announced by a `role="status"` region that is **rendered always and emptied**:
  mounted only while busy, the change a screen reader has to notice is the
  region arriving, and there is nothing yet to read.
- **`ProfilePage` syncs the display-name field from the *stored name*, not from
  the user object.** Every write to the auth context replaces that object —
  saving a picture, removing one — so an effect keyed on `[user]` reset the
  field on each of them and threw away a name that had been typed and not yet
  saved. Silently: the upload itself succeeded. Pinned by a spec that nests its
  own provider, because `renderWithProviders` stubs a *fixed* user and the bug
  needs the record to actually be replaced — the first version of that spec
  passed against the broken code.
- **The store reads `avatar_updated_at` as a `*time.Time`.** A row whose
  version is NULL breaks no rule the schema enforces, and scanning NULL into a
  `time.Time` is a driver error rather than a domain one — so it would answer
  500 from the one route whose every failure is meant to be an
  indistinguishable 404.
- **The conditional request is answered by `http.ServeContent`, not by comparing
  the tag here.** A browser echoes an ETag verbatim, so a string comparison
  looked sufficient — but `Cache-Control: public` invites a shared cache in
  front of the route, and those revalidate with a *list* of tags or a weak one.
  Either misses an exact comparison and is answered with the whole image body,
  silently. It is also what pays for the header being short — `max-age=300` and
  no `immutable` — because **a delete cannot reach a cache.** A *replacement* is
  a new address, which is what `avatar_updated_at` in the `?v=` is for and still
  is; a removal mints no new version, so there is no new address to send anyone
  to and nothing that recalls the old one. The freshness window *is* the
  deletion's real latency: for the whole of it a removed picture stays on other
  people's screens while the origin answers 404, and `immutable` for a year
  meant that for a year, unclearable by a reload. Five minutes costs almost
  nothing here precisely because of the sentences above — each revalidation is a
  304 of a couple of hundred bytes, and after a removal it is the one that
  reaches the 404. What is left is that the person who removed their picture
  sees it gone at once and nobody else is promised that for another five
  minutes.

### The Next.js shell

The app is a Next application whose every route is still a react-router route:
`src/app` holds a root layout and one optional catch-all page, and everything
under `src/AppRoot.tsx` is the app that used to be mounted by `main.tsx`. That
arrangement is deliberate and temporary — it is what let the move off Vite change
no application code — but while it stands, these are the parts holding it up.

- **`AppRoot` is imported through `dynamic(..., { ssr: false })`, and that is
  what makes every rule below the shell keep applying unchanged.** The providers,
  `BrowserRouter`, the module-scope `QueryClient` and every route run in the
  browser and only there, exactly as they did under Vite — so the module-scope
  `localStorage` reads, the import-time `setTokenProvider`, the `useState`
  initializers that read storage and `window.location.origin` in a render body
  are all still safe. Remove the `ssr: false` and they are not; that is the first
  work any server-rendering change has to do, and doing it needs the four
  render-phase reads found in `ListsPages`, `SongDetailPage`, `ListSongNav` and
  `lib/theme.ts` fixed first. `ssr: false` is legal only inside a client
  component, which is why `app/[[...slug]]/client.tsx` exists between the page
  and `AppRoot` rather than the page importing it directly.
- **The theme is applied by an inline script in `app/layout.tsx`, which is a
  hand-written copy of `applyTheme(storedTheme())` and of the `lyrics:theme`
  key.** Nothing bundled runs early enough: the script has to execute while the
  parser is still ahead of anything with a background color, and the app's own
  JavaScript now arrives later than it did under Vite. So the rule lives in two
  places, the same trade `extractVideoId` makes against Go's `parseYouTubeURL`,
  and `lib/theme.ts` says so at the definition. Change one and change the other;
  miss the script and every dark-theme load flashes light first, on every page.
  `theme.test.ts` is what makes that instruction more than an instruction — it
  runs the exported string case by case against `applyTheme(storedTheme())`, the
  way `youtube.test.ts` holds `extractVideoId` to the Go parser it mirrors, since
  a divergence here shows only as one white frame and only to a visitor whose
  theme is dark. `suppressHydrationWarning` on `<html>` is part of it — the
  script legitimately makes the client's markup differ from the server's. And
  the script declares its two temporaries with `let`: an inline `<script>` runs
  in global scope, where `var` inside a block is still function-scoped, so `var`
  put `window.t` and `window.d` on every page in the app. That is the other
  thing the spec pins, by asking for the globals rather than the class.
- **The `/api` proxy is a `rewrites()` entry in `next.config.ts` and is
  development-only.** It replaces the Vite dev-server proxy, and `make mobile`
  is what depends on it: emptied `NEXT_PUBLIC_API_BASE_URL` sends every call
  same-origin, and this is what forwards it to :8080. It is guarded on
  `NODE_ENV` because in production the App Platform ingress routes `/api` to the
  Go service before Next sees it — left ungated it would be dead config that
  looks live, and would quietly become the thing serving `/api` if that ingress
  rule were ever dropped.
- **`allowedDevOrigins` is the other half of `make mobile`, and without it that
  workflow does not merely degrade — the app never boots.** Next blocks
  cross-origin requests to `/_next/*` in development, and `next dev -H 0.0.0.0`
  puts `localhost` and the *bound* hostname on the allowlist, which is
  `0.0.0.0` and never this machine's LAN address. Some of the app's own script
  tags carry `crossorigin`, so their fetches send an `Origin` header and are
  answered 403: `http://<lan-ip>:5173` on a phone serves the document, fails
  three chunks including `AppRoot`, and leaves a blank page with an untitled
  tab. Nothing about it is visible from the machine being developed on, whose
  origin is `localhost`. The entries are hostnames matched segment by segment —
  no scheme, no port — so they are the private ranges rather than one address,
  and `172.*.*.*` is wider than RFC 1918's `172.16–31` because the matcher has
  no numeric ranges; the list is read by `next dev` alone, where it decides
  which other private host may read dev assets and nothing else.
- **The security headers are a `headers()` entry in the same file**, ported from
  the deleted `web/nginx.conf`: `X-Content-Type-Options`, `Referrer-Policy` and
  `X-Frame-Options: DENY`. They were repeated per-location there because nginx's
  `add_header` does not merge across levels; one entry covers everything here,
  and nothing else sets them. `poweredByHeader: false` is beside them and is
  not one of them: `headers()` can add a header and not remove one, so the
  `X-Powered-By: Next.js` that nginx never sent is switched off at the source.
- **`web/AGENTS.md` and `web/CLAUDE.md` are written by `next dev`, not by
  anyone here.** Next 16 generates them and re-adds the block on every run, so
  they are tracked rather than ignored — deleting them only produces the same
  uncommitted change again. `web/CLAUDE.md` is one line importing `AGENTS.md`;
  this file is still the authority, and that one carries Next's own warning that
  the installed version differs from what a model was trained on, with the
  bundled docs under `node_modules/next/dist/docs/` as the reference.
- **Vitest keeps its own Vite pipeline, in `vitest.config.ts`.** The app is built
  by Next and the tests are transformed by `@vitejs/plugin-react`, which is why
  that package is still a devDependency and why `tsconfig.json`'s `jsx` setting
  is read by neither. `next build` rewrites `jsx`, `allowJs` and
  `esModuleInterop` if they disagree with it, so they are not choices to make
  there.

### Frontend

- **`BrowsePage`'s debounced-search effect needs its guard.** `setParams` is not
  referentially stable, so the effect re-runs after *any* param write; without
  the guard it clears `page` every time and pagination cannot advance. The
  failure is silent — the button works, the same rows return.
- **Song pages link credits to `/?person=<id>`.** Browse must read that param,
  or clicking an artist lands on the unfiltered catalog with no error, reading
  as "this artist is on every song".
- **A video is read from `youtube_video_id`, and `youtube_url` is never
  rendered as an href.** True of a recording's pair and of the song's copy of
  it alike. The two columns look interchangeable and are not: the
  API writes them together, having parsed one from the other, but the catalog
  importer stores whatever the old database held and sets the id only when it
  parses. So a URL is validated text on one write path out of two, while an id
  is eleven characters of `[A-Za-z0-9_-]` or it is absent. `WatchOnYouTube`
  therefore takes the id and builds the link, which is the same idiom the search
  snippets use — a wrong destination is impossible by construction, not filtered.
  Gating on the URL instead also disagrees with `SongCard`'s badge, which reads
  the id: the card says there is no video and the page offers one. What the link
  replaced was **not an embed but a click-to-load facade**, and the difference
  matters to anyone tempted to bring it back as the cheaper option: the player
  was already deferred to a press, so the megabyte was never being spent. What
  the facade did spend was a request to `i.ytimg.com` for a thumbnail on every
  song page, watched or not, and that is the cost the link actually removes —
  along with the deferred-player state that had to be kept honest. A song page
  now loads nothing from YouTube at all.
- **The link is parsed in two places that cannot be made to share one**, like
  the email-verification scope above: `parseYouTubeURL` (Go) is the authority,
  and `extractVideoId` (`web/src/lib/youtube.ts`) is a deliberate mirror of it
  because the
  editor's preview is the only confirmation a contributor gets that a pasted
  link was recognized. So the two disagreeing is a verdict the save then
  contradicts, and it is silent in both directions — a host on the server's list
  and not the client's leaves the field dark on a link that saves fine, and one
  on the client's alone previews a link the save refuses. `m.youtube.com` and
  `music.youtube.com` are the ones a host check written from memory drops, and
  they previewed only by accident before the mirror. Add a host or a path shape
  to both, or to neither.
- **The credit role labels live in `lib/credits.ts` as two maps, and they
  deliberately differ.** `CREDIT_DISPLAY_LABELS` says what a person contributed
  ("Music") because that is what reads under a heading a reader scans;
  `CREDIT_PICKER_LABELS` names the role being chosen ("Composer"). Held in the
  two route files instead — where they were — the divergence looks like a
  mistake, so one gets "fixed" to match the other, and nothing recorded that it
  was deliberate. `CREDIT_DISPLAY_ORDER` is beside them for the reason it always
  was: the page's grouping and the byline cannot disagree about the order.
- **`songByline` blends two fields, and the card and the quick search both read
  it.** Performers from `recordings[0]` lead, then the composer and lyricist —
  which is the order that line has always had, when performing was a credit role
  sorted to the front. Names are Set-deduped across *both* sources, so someone
  who wrote a song and also performed it appears once. Two call sites, and the
  quick-search one is the easy one to miss: it renders the same line and would
  have silently lost every performer name.
- **Browse's filter chips are keyed on what is in the URL, never on the filter
  being found.** A genre can be deleted from the admin console while someone
  holds a link filtered by it, and the request still answers — with no songs,
  since the filter is an `EXISTS` on a slug that now matches nothing. Rendering
  the chip only when the genre resolves leaves that reader on an empty catalog
  with a lit filter button, a badge counting the filter, and nothing to press to
  clear it; the only way out is the filter sheet's "Clear all". The artist chip
  had this right first — `activePerson?.name ?? "Artist"` — and the genre chip
  now falls back to the raw slug the same way.
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
- **`AuthProvider` opens on the last session this browser had, read from
  `localStorage` — and that snapshot decides what to *draw*, never where anyone
  goes.** Restoring a session is two round trips, the SDK's token refresh and
  then `GET /me`, and starting from `null` meant every refresh of a signed-in
  page painted the *guest* answer first: a navigation offering Sign in with no
  Lists in it, a catalog with no Add song, all replaced a few hundred
  milliseconds later. It is the same trade `applyTheme(storedTheme())` makes in
  `main.tsx` — paint the last known answer rather than a wrong one — and it is
  safe for the same reason `hasRole` is: the server is the authority, so a stale
  role costs one paint of chrome whose every action is refused. No token is ever
  kept there; the SDK owns those, and `auth/session` says so. What the snapshot
  must not do is move anybody, which is why **`loading` keeps its exact meaning
  and every redirect reads it first**: `VerificationGate`, the sign-in and
  sign-up screens' "already signed in" redirects, and `VerifyEmailPage`'s
  challenge-opening effect all wait for the restore, and each of them is pinned.
  Left unguarded, a snapshot taken before an address was verified on another
  device bounces a verified visitor to a code form and then to the catalog rather
  than the page they opened; a snapshot outliving its session sends someone who
  came to sign in to the catalog and leaves them there as a guest; and a step-up
  opened on a session Prelude has not restored yet fails as "we could not send a
  code" with nothing wrong. The write is **one effect keyed on `[user]`** rather
  than a line at each call site — sign-in, sign-out, a dead session, a new
  picture, a changed name all end in `setUser` already, and the call site that
  forgets is the one that leaves an account remembered on the machine it signed
  out of. `storedUser` **validates rather than casts**: a snapshot from an older
  release is missing whatever the shape has gained since, and the field worth
  naming is `email_verified_at`, which nothing draws — absent reads as
  unverified, leaving the gate's wait on `loading` as the only other thing
  between that and a verified visitor sitting at a code form. What is left is a
  reverse flash, and it is deliberate: a session that has really ended paints
  signed-in chrome for one moment — a name and an address, so on a shared machine
  it is the last person's — and then the restore (or a 401) clears the user, the
  query cache and the snapshot together. It is rare, it heals itself, and it is
  the trade for not flashing guest at every signed-in refresh. A `GET /me` that
  cannot be answered at all — a 500, a reload with no network — takes the
  snapshot with it, and that is the existing contract rather than a new one:
  `loadProfile` has always swallowed every failure into `null`, so an
  unreachable API already reads as signed out for that load and the snapshot
  only follows the state. The cost is one further guest flash on the next load,
  and the first restore that succeeds writes it back.
- **`useList`'s `ready` flag is belt-and-suspenders now, but the skeleton beside it
  is not.** The flag was the first fix for that 404 — gate the query until
  `useAuth().loading` clears — and it is redundant since the provider moved to
  import time, because the request carries a token either way. What still bites
  is the trap next to it: a disabled query is not `isLoading`, so
  `ListDetailPage` has to hold its own skeleton while waiting, or it falls
  through to "not available" and tells the owner their list is gone.
- **`SongDetailPage` renders its chrome while the song is in flight, so its
  failure branch reads the request rather than the absence — and reads
  `isLoading`, never `isError`.** `!song` is true for the whole of a load once
  the shell no longer sits behind a skeleton, so `!song` alone paints "not
  available" on the way *into* every song; `!isLoading && !song` is the pair, and
  a query that was never enabled — no `id` — still reaches it, a disabled query
  not being `isLoading` either. `isError` is the disjunct that is **not** there,
  and it is the one that looks obviously missing: it is only ever true here with
  a song already in hand, since a first attempt that fails leaves no data and is
  caught by the pair above. That leaves exactly one case — a *refetch* that
  failed, which react-query runs on every return to the tab — so adding it takes
  the lyrics off the screen of someone reading them on a phone that lost signal,
  to report a request they never made. The cached song stays instead, which is
  the deliberate trade: a song deleted by somebody else stays readable until the
  page is reloaded, and a failed refresh says nothing. Pinned by a spec that
  presses a control after the refetch fails, because the refetch's promise
  resolves before react-query has told the page — asserting straight after it
  passes with the disjunct back in. What the shell buys is that Back, Save, the
  editor link and the list bar do not blink out at each step through a list. The
  paging *swipe* is the one piece that still waits for the song, and
  deliberately: the mark explaining it
  is spent once per device the moment it is on screen, so mounting it over a song
  that never arrives spends that showing on a page with no gesture on it — the
  failure `useSwipeHint`'s observer exists to prevent, arriving from the other
  side. What the shell costs is two decisions that have to be made without a
  song. Editing is one, and it is answered in `canEditSong` rather than beside
  the call: its admin check comes
  *before* it looks at the song, so an admin's row is the row it will still be,
  and the page asks the shared helper instead of re-deriving the admin case for
  itself. Put that guard back in front and the link appears a moment late, under
  the finger of someone reaching for Save. Deletion is the other, and it waits,
  being the one confirmation that names the song it is about. The skeleton left
  in the shell is shaped like the header most songs have — credit lines, the
  recordings button and a genre chip included — because the text-size controls
  sit under it and they are controls, so `SongHeader`'s spacing and that block
  have to move together, and jsdom lays nothing out, so nothing says otherwise.
  The recordings line is what that rule cost the first time it was tested: the
  button arrived with the header's new "Show all …" row and moved the heading
  under it by 28px until the block beside the call site grew with it. Its `mt-2`
  needs a plain wrapper of its own there, and not for the specificity reason
  that suggests itself: `space-y-*` is emitted inside a `:where()`, which has no
  specificity at all. What it does have is a `margin-block-end` on every child
  but the last, so a button dropped straight into the group has its 8px top
  margin collapse against the credits' 12px bottom one and lose — the class
  written and then ignored, the gap the group's rather than the button's. `ListDetailPage` keeps the
  older shape on purpose: nobody pages through *lists* the way a reader pages
  through the songs in one, so the flicker this removes barely arises there, and
  its early return also stands in for the session wait.
- **The verification gate wraps `<Routes>` and reads `user.email_verified_at`;
  `VerifyEmailPage` waits for `loading` before deciding, and its
  challenge-opening effect checks the same flag itself.** Three separate traps,
  and the three waits are not the same wait. The gate holds nobody until the
  restore settles — but it renders what was asked for while waiting, rather than
  a spinner in front of every visitor's first paint, which is what a gate that
  *blocked* on `loading` would be. The page is the opposite: it is reached by
  redirect and stays in the address bar, so deciding before the session is
  restored turns a refresh into a bounce to `/login`, and a spinner is the right
  thing to show. And the effect needs its own check because hooks run before the
  redirects below them are rendered — without it, a visitor who is already
  verified opens a challenge and is emailed a code on their way past.
- **The sidebar and the phone's drawer render one `NavPanel`, and that is what
  the drawer bought.** What a phone had before was a bottom tab bar — a second
  list, agreeing with the sidebar only by hand. It had no identity card and no
  Sign in button, so `/profile` had to stay in `NAV_ITEMS` unfiltered on the
  phone's account while the sidebar filtered it out, and every rule below was a
  rule with two halves. Shared, they have one: the card stands in for the entry
  wherever there is a card, and a guest gets the link and the Sign in button
  wherever there is not. `identityCard` is that filter and the reason the item
  is not `authOnly` — a guest filtered out as well has no route to `/profile` at
  all, which is where the theme switch lives and nowhere else. Nothing says so
  from the machine the change is made on, whose navigation has a card. The
  filter sits **inside `NavPanel`** rather than at either call site, because
  whether the card stands in for an entry is the panel's own question: asked
  from outside, the next reader gets the link *and* the card, both pointing at
  `/profile`. What is pinned in `Layout.test.tsx` is *which* navigation holds
  the way to the profile, asserted of both — jsdom has no breakpoints, so the
  sidebar and the drawer are in the document at once and that is the only
  readable form of which reader is served. It is asserted of the `/profile`
  destination rather than of the label the entry carried, since a rename leaves
  a second route to the profile above the card with every assertion about
  "Profile" still passing. And it is asked **inside the `<nav>`**, which is the
  third thing the card being the entry costs: the footer it lives in sat beside
  that landmark, so a reader navigating by landmark got Browse, Lists and Admin
  and no route to their own profile — working perfectly for everyone who can see
  it. The footer moved inside the nav, and `flex-1` on the nav is what keeps the
  layout: it takes the height the container was holding, so the footer's
  `mt-auto` still has room to reach the bottom rather than stopping at the foot
  of the links. The last piece is the card's lit and pressable treatments, which
  are the links' own and are **shared as tokens rather than copied**, since
  nothing pins the two agreeing: without the first, the profile screen is the
  one place in the app where nothing in the navigation is lit, and without the
  second — the link being gone — nothing is left saying the card can be pressed
  at all. Only the lit token carries a text color, and that asymmetry is
  deliberate: lit, the card's name takes the brand color exactly as a label
  does, while at rest the links name a stone the card leaves to inherit. The
  role line names its own either way, so it stays put under both.
- **The drawer stays mounted while closed, and three things follow from it.**
  Sliding is the point — a panel that unmounts has nothing to transition from —
  and everything here is what that costs. It carries `role="dialog"` and
  `aria-modal` **only while open**: `lib/modal.ts` asks the DOM for exactly that
  pair and never for anything visible, so a closed drawer wearing them puts a
  modal on the page for the whole session, and the song page's paging swipe and
  arrow keys stand down permanently — on phones only, silently, with the drawer
  itself behaving perfectly. `Layout.test.tsx` asks `modalIsOpen()` of a closed
  drawer, which is what says so. **The marking is returned by `useModal` rather
  than written by either modal**, which is what keeps "write it conditionally"
  from being a rule an author has to remember: a modal that stays mounted gets
  the conditional for free, and the `<dialog>`/`showModal()` migration
  `lib/modal.ts` names becomes a change to that one module. The same hook
  carries Escape, the scroll lock and the focus — deliberately **two effects
  with different keys**, which is the whole reason it is a hook rather than one:
  every call site passes `onClose` as an inline closure, so a focus restore
  living in the first effect's cleanup fires on any render while the modal is
  open and pulls focus onto the trigger behind the backdrop. Only the drawer
  passes `focus`, a modal that unmounts having focus inside it already. It is
  `inert` while closed, so its links
  are out of the tab order and the accessibility tree rather than being a second
  copy of the navigation a keyboard reaches through the page, and
  `pointer-events-none` says the same to a browser that does not know `inert` —
  without it the invisible backdrop swallows every press on the page behind.
  The backdrop's **blur is gated on `open` while the element is not**, since
  `backdrop-filter` is a composited layer the size of the viewport and would
  otherwise be one on every page for as long as the app is open; it drops at
  once rather than fading, which is invisible behind 40% black on its way out.
  And it closes on **the location, not the pathname**: a link to the screen the
  reader is already on pushes a new entry with the same path, so a drawer
  watching the path alone is left standing open with nothing having happened.
  That is its own effect rather than a line in the scroll-to-top one beside it,
  whose `pathname` key is deliberate — a filter written into the catalog's query
  string must not scroll that page back to the top. **A window that grows past
  `md` closes it too**, which is a `matchMedia` subscription in a codebase that
  otherwise leaves every breakpoint to CSS, so it needs saying why.
  The panel and the hamburger are both `md:hidden`, so crossing the breakpoint
  takes the whole control off the screen while `navOpen` goes on saying it is
  open — and an open drawer nobody can see still costs everything an open modal
  costs: the scroll lock freezes a desk's page with no modal on it, and
  `modalIsOpen()` reads the marking off the DOM without asking what is visible,
  so the song page's swipe and arrow keys stand down for the rest of the
  session. A phone turned to landscape is 812px or more, so it is one rotation
  away. It does not contradict `StickyHeader`'s reason for refusing
  `matchMedia`: that one keeps a *class* in step with a window and hands the job
  to CSS, where this is a one-way close of state whose only control has gone.
  Pinned in `Layout.test.tsx`, which installs a `matchMedia` that can be moved —
  the suite-wide stub answers `false` forever and registers no listeners.
- **The hamburger is rendered by the app bars, and a screen gets its bar by
  position.** The shell has no row of its own on a phone, and giving it one
  would hand back the vertical space the tab bar was removed to reclaim — so the
  button goes in the header a page already carries. `SearchHeader` leads its row
  with it, unconditionally rather than by a prop, for the reason that component
  exists at all: a page with the choice is a page whose field starts 52px
  further left than the next one's, and that box moves under the finger that
  just tapped through it. Every other screen gets `MenuHeader`, the same
  `StickyHeader` and the same column with nothing but the button in it — and
  gets it from `MenuBarLayout`, **a layout route around the section rather than
  a wrapper written per screen**, which is `RequireAdmin`'s shape below for
  `RequireAdmin`'s reason. Per route, the wrapper invites the failure it exists
  to prevent: a route copied from one of the two exceptions above it ships a
  screen with no navigation at all on a phone. Per page is worse, a page having
  to carry it in every state it can be in — `ListDetailPage` has three returns
  to `ProfilePage`'s two. What is left for a spec is the part position cannot
  rule out, and `App.test.tsx` is it: it walks every address inside the shell
  asking each for the one hamburger, and it **has to render the real route
  table**, since the two mechanisms cannot see each other and nothing else looks
  at both — the drawer's own specs mount a stand-in route tree and every page's
  specs render the page with no shell at all. The column the two bars share is
  one string in `SearchHeader.tsx`, and the spec compares them rather than
  naming the classes: written out, it pins a copy staying in sync, which is the
  weaker guarantee that component exists not to rely on. `MenuHeader` is
  `mobileOnly` and that class belongs on the `<header>` rather than on what a
  caller puts inside it, since a bordered box with a hidden child is still a
  bordered box — a hairline across the top of every screen at a desk; wrapping
  it instead breaks the stickiness, a sticky element being confined to its
  parent's box. The trigger and the drawer
  cannot be one component: `StickyHeader`'s transform and backdrop filter each
  make it the containing block for anything `fixed` inside it, so a drawer
  opened from the button would slide off the top of the screen with the header.
  `lib/navDrawer.ts` is what joins them, and its default is a drawer that cannot
  be opened — every page's own specs render that page with no shell above it,
  and throwing there would make `Layout` something each of them has to mount.
- **The admin console is a guarded section, not a pair of guarded screens.**
  `RequireAdmin` wraps the `/admin` layout route, whose element is the console's
  own chrome around an `<Outlet/>`, so a screen added below it is admin-only by
  position — the wrapper is not something the next screen can be written
  without. Written per route instead, as it first was, a forgotten wrapper
  renders that screen for everybody and the server refusing its writes is all
  that says so. Being outside the pages also keeps the console's chunk off the
  machine of anyone who cannot open it, and the heading comes from the tab that
  matches the address so a screen's name is written once rather than in the
  route, the tab, and a title prop. Two smaller traps in the same place. The
  navigation carries one entry and it names the *section*: a `NavLink` matches
  on prefix, so an entry naming a screen — as it did, `/admin/users` — goes dark
  the moment an admin opens the other one, and the console then still works
  while no longer saying where the reader is. `/admin` therefore needs the index
  redirect, being a section with no screen of its own. And the gate *blocks* on
  `loading` where the verification gate only reads it — that one renders what was
  asked for while the restore is in flight, and this one cannot: until the
  restore settles `user` is the snapshot of the last session this browser had, so
  deciding then either bounces an admin off their own page on a reload or opens
  the console on the role that snapshot merely remembers. A spinner in front of
  one section is nothing like one in front of every visitor's first paint. The
  section's screens live in `routes/adminTabs.ts` rather than in the console
  itself, because `App.tsx` opens `/admin` on the first of them and importing
  that list from the console's own module would pull its chunk into the bundle
  every visitor downloads.
- **A screen that reads `isLoading` and a length must read `isError` too.** Both
  admin screens shipped without it and both said the same wrong thing: a failed
  request has no rows, so "No users matched." and "No genres yet" stood in for a
  fault — and on the genres screen the advice that follows is to add the genres
  that already exist, each of which is then refused as a duplicate slug for
  reasons the screen cannot explain. `BrowsePage`, `SongDetailPage` and
  `ListDetailPage` all branch on `isError`; anything listing rows must.
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
  a mouse has no such conflict. The gesture is claimed or dropped at the moment
  the finger goes down, which is where four of its six guards live: one finger
  only, clear of the edges, no open sheet, and not starting on a control. "A
  sheet is open" is `lib/modal.ts` — one question for the swipe and the arrow
  keys both, asked of the DOM rather than of a page, so the next sheet is covered
  without being added to a list. There are two modals — `Sheet` and the phone's
  navigation drawer — and neither writes the pair of attributes it looks for:
  `useModal`, in that same module, hands each of them the marking already
  resolved for the open state, so a move to `<dialog>` and `showModal()` is a
  change to `lib/modal.ts` and nowhere else. That is also what makes it safe for
  the drawer to stay mounted while closed; see the Layout bullets above. The control guard is belt
  and suspenders and deliberately the safe way round — a swipe over a control does
  nothing, rather than a control being unreachable under the gesture, which is
  precisely how the strips went wrong.
- **The other two guards cannot be asked at touchdown, and one of them is a
  comparison rather than a question.** A second finger arriving partway through
  is read on the move. A movement that **changed what is selected** is read at
  the end, against the selected *text* recorded when the finger went down — not
  by asking whether anything is selected now. That weaker form looks equivalent
  and is not: it catches the long press that drags sideways, but a drag on a
  selection *handle* starts with something already selected, so it sails through
  and pages the song, destroying the selection and the reader's place in the list
  in one movement. Comparing also means a selection left on the page from earlier
  cannot quietly kill every swipe after it. Both directions are pinned, and the
  weak form fails the extend spec.
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
  Two smaller traps in the same hook: the mark is held in **state, set from a ref
  callback**, because a `RefObject` is the same object on every render and so
  would never re-run the effect — on a list that gains a second song while it is
  open the mark then renders with no observer ever made, and that reader has the
  one showing neither spent nor delivered. And the mark is dropped a further
  `HINT_FADE_MS` after the fade *starts*, which is what makes "not rendered at
  all" true rather than aspirational: unmounting with the fade cuts it instead of
  playing it, and never unmounting leaves the invisible box the sentence above
  promises there is none of, since stepping to a cached song does not remount
  the page.
- **A song reached from a list carries `?list=<id>`, and every step keeps it.**
  Dropped anywhere along the way, the next song is a dead end: the page still
  renders, the reader is simply out of the list with nothing saying so. Which is
  why `lib/listContext.ts` builds every destination — a `ListPosition` hands the
  navigation the `previousHref` and `nextHref` it steps to, so no component below
  it can forget the parameter, and only `SongCard` (whose row passes `listId`)
  composes one itself.
- **Steps through a list are `replace`d, not pushed.** Back — the browser's
  button, the phone's gesture and `BackButton`, which are all one history — is
  the way *out* of the list, landing on whatever the *song* was opened from —
  which, for a reader who came in through the list, is the list itself. Pushing
  was the earlier answer and the trail it built is what this undoes: the way out
  of a twenty-song list was twenty presses of one control, each landing
  on a song page that looks like the one before it, with nothing on screen saying
  how many were left. Three things step through a list and no more — the bar's
  two arrows, the swipe, the arrow keys — and each says "replace" in its own way,
  a prop on a `<Link>` against an option on two `navigate` calls, so **one of
  them regressing is invisible in the other two**: it changes no address, and
  shows up only as Back refusing to leave the list. All three are pinned
  separately in `SongDetailPage.test.tsx`, against a route array, since a trail
  is not something an address can show. A fourth was dropped in the same change,
  and its own cost is worth knowing: the footer naming the songs either side was
  the one thing at the end of long lyrics saying where they led, so a reader at a
  desk who has scrolled the bar away now has no visible way on — the arrow keys
  are undiscoverable and the mark that advertises the swipe is `md:hidden`. The
  neighbors' *titles* went with it, `ListPosition` carrying addresses only, so
  naming them anywhere again means putting that field back.
- **The list's own name in the bar is the exception and still pushes**, being a
  link to another page rather than a step through this one. Given `replace` for
  consistency with the arrows, a reader who arrived from that list is left
  holding two identical entries in a row and a Back press that appears not to
  move — the duplicate-entry trap the editor's way out documents below, and
  pinned here by the spec that presses the name and then goes back to the song.
  What replacing everything else costs is the shared link: a reader who opened a
  song cold has one entry and no page behind it, so a step replaces the only
  thing Back could have returned to and the next press leaves the site. That
  reader is exactly who the list's name has always been there for, and it is the
  accepted cost — a song opened cold was never in a trail to keep.
- **A search jump is the one destination that leaves `?list=` behind, and it has
  to.** Every other address on the song page carries the list forward, so this
  reads as the omission the bullet above warns about and is the opposite: a song
  found by searching is not the reader's next song in that list and very often is
  not in it at all, so keeping the parameter would put a bar on it counting a
  position it does not hold, with steps to the songs either side of somebody
  else's place. `SongSearch` therefore calls `songHref(song.id)` with no list, and
  the spec that says so is the only thing standing between that and a
  well-meaning "fix".
- **The song page's quick search is a combobox whose rows cannot take focus, and
  that is what keeps it out of the page's own gestures.** `useArrowKeyPaging`
  stands down for a focused field, so left and right belong to the caret while
  the results are up; let focus come to rest on a row instead and an arrow
  pressed there pages the list out from under the panel — the results vanish and
  the reader is on another song. So focus never leaves the field, the highlight
  is `aria-activedescendant`, and every row carries `tabIndex={-1}`. With that,
  nothing here has to ask `modalIsOpen()` and nothing has to stop an event
  propagating: there is no conflict left to resolve. Two smaller pieces of the
  same rule. The box is a sibling of the `<article>` rather than something inside
  it — which is the whole reason `SongDetailPage` is a shell of two components —
  because the article is the surface the paging swipe is read across, and a
  gesture begun in the results would page the list. And the panel is dismissed by
  a `pointerdown` listener rather than by a full-screen transparent element,
  which is the shape of thing the tap strips were.
- **`StickyHeader` is shared by two pages — both reaching it through
  `SearchHeader` — and its rule is a class.** It hides on the way down only below
  `md` — a desk has the height to spare — so the whole of
  "out of the way on a phone, sticky at a desk" is the `max-md:` prefix on one
  transform, and dropping it changes the catalog page as much as the song page.
  That is why the spec lives beside the component in `Layout.test.tsx` rather than
  inside either page's: read through one page's render, the other page's behavior
  rides on a spec that has nothing to do with it. The rest of the reasoning — why
  a Tailwind variant rather than `matchMedia`, and what `pinned` is for — is on
  the component.
- **`SearchHeader` renders that sticky chrome itself, and owns the column and the
  field's share of the row, so that no page can choose any of them.** The search
  box is the one control that stays on screen through a navigation, so anything
  that moves it moves under the finger that just tapped a row — and every cause
  was in the markup rather than in any behavior. The catalog's column was
  `max-w-3xl` against the song page's `max-w-2xl`, which slid the field sideways
  on the way in and back on the way out; only the catalog carries a filter
  button; and the filter *count* was text beside that button's icon, so applying
  a filter widened the button and shrank the field in place. Hence one component
  around `StickyHeader` rather than beside it: "a sticky header with a
  hand-rolled column" is then not a thing a page can write, which is worth more
  than a spec saying not to — a spec rendering this component can only ever see
  the column it hardcodes. `flex-1` is in here for the same reason, since a
  caller stating its own proportion is the same divergence one level down. The
  count is a badge over a square button — an `icon` size in `buttonStyles`, since
  `cn` is a plain join and `px-4 px-3` leaves the width to whichever Tailwind
  emitted last — and `trailing` is emphatically **not a reserved slot**: a page
  with no control to put there gives the field that width instead, and the slot
  is not rendered at all, the row's `gap` alone being 8px of the field. A slot
  held empty was the first fix and the wrong one; it kept the box identical to
  the pixel while leaving it a half-button left of center on the page that had
  nothing to fill it, and off-center reads worse than a right edge that moves. So
  the right edge is the one part of the field a page carrying a control cannot
  share, and it is the deliberate cost — which is the half `SearchHeader.test.tsx`
  pins, being a choice rather than a structure. **`SongDetailPage`'s own column
  followed the header rather than the reverse**, and every state of that page
  carries it — the skeleton and the "not available" message too, or the width
  changes as the song arrives. A song page's field was 96px wider than the
  article under it while the article kept `max-w-2xl`, so the open results panel
  hung past the lyrics it covered by 48px on each side; the lyrics are short
  lines rather than prose, so the wider measure costs them nothing. **The last
  cause is in no component at all** — a page long enough for a scrollbar and one
  short enough to go without slide a centered column sideways by half a
  scrollbar between them, so `scrollbar-gutter: stable` is on `html`. Invisible
  on a Mac, where scrollbars overlay and reserve nothing, which is exactly why
  it is written down.
- **Everything the editor hydrates goes in the one `hydratedFor` effect**, and
  recordings are the deepest thing in it. Given an effect of their own — keyed on
  `existing`, which react-query replaces on every refetch — a reconnect throws
  away a recording that had been typed and not yet saved, silently, since the
  form still looks filled in. The whole payload is sent on every save, so the
  loss lands in the database on the next one.
- **The first-recording control is a radio group with an explicit "none"
  member.** At most one recording may claim it, which radio semantics give for
  free; but all-false is a state the data really holds — the mark is a claim
  about history a contributor may be unable to make — and a radio cannot be
  cleared by pressing it again. The extra member is also what makes removing the
  marked recording need no rule about which one inherits the mark: none does.
- **The editor leaves by popping the history, not by navigating to the song.**
  It is only ever reached from the song's own page, so replacing its entry with
  that song — which is what saving used to do — leaves two identical song
  entries in a row: Back lands on a page that appears not to have moved, and it
  takes a second press to reach the list. Nothing about the address says so,
  which is why it read as a broken back button rather than a duplicate. Popping
  also restores the previous URL verbatim, and so is the only thing keeping
  `?list=` on the way out — the Edit link drops it, and any destination built
  here would drop it too. Two things do navigate instead, for two unrelated
  reasons, and folding them together is the way to lose one: an editor address
  opened in a fresh tab has nothing behind it, which `location.key ===
  "default"` is what identifies; and adding a song has to land the reader on
  what they created rather than on the catalog they opened the form from, which
  is the `isEdit` branch and nothing to do with the key — an in-app `/songs/new`
  has a perfectly ordinary key and a page behind it, which is why *canceling*
  there does pop. Both navigate with `replace`, so Back cannot return to a form
  already saved. Pinned from both sides, address *and* trail, in
  `SongEditorPage.test.tsx`: a fix that kept `?list=` while still duplicating
  the entry passes that spec's every assertion about the address.

### Head assets

- **A missing file under `public/` does not 404 — it serves the app.** Every
  unmatched path is a React Router route, and the thing that makes it one has
  changed identity twice without the hazard changing at all: it was
  `catchall_document` on App Platform and `try_files` under nginx, and it is now
  the optional catch-all page under `src/app`, which matches any path Next did
  not already answer from `public/`. So `/favicon.ico` answered `200 text/html`
  with the app in it, and **still does** for a path with no file behind it —
  verified against `next start`, not assumed from the routing. That is worse
  than a 404 in the one way that matters: the client succeeded, so it has
  nothing to fall back to, and anything that does not read SVG favicons
  (crawlers, feed readers, link-preview bots) showed no icon at all while
  `/favicon.svg` sat there working. The same swallows `/apple-touch-icon.png`,
  `/manifest.json` and `/robots.txt`. **Deleting one of the four icon entries in
  `app/layout.tsx` therefore breaks nothing visibly** — check the content type,
  not the status.
- **`app/layout.tsx` exports no `metadata.title`, and adding one pins every tab
  in the app to "Songfolio".** `PageTitle` works by rendering a `<title>` that
  React 19 hoists into the head, and `document.title` is the *first* title
  element there. React puts a hoisted title ahead of one it does not manage,
  which is why index.html's static title was a fallback and this worked under
  Vite. A `metadata` title is not such a node: React renders it too, from the
  layout, which is above every route — so it sorts first, wins the read, and is
  written again when the streamed metadata boundary resolves after hydration.
  The specs cannot catch it, because jsdom has no competing title to lose to.
  What is given up is a title in the server HTML for a reader running no
  JavaScript, which today is a reader getting no content either; `og:title`
  still carries the name to link previews. Both directions verified in a real
  browser, including against the deployed Vite build.
- **The rasters come from `icons/icon-square.svg`, not from
  `public/favicon.svg`.** The favicon has `rx="7"` and is transparent outside
  that radius; iOS composites its own mask over an opaque square, so
  rasterizing it puts dark wedges in the corners of the home-screen icon —
  invisible anywhere but an actual phone. `icons/generate.mjs` renders every
  PNG and the ICO from the tracked sources beside it; `sharp` and `png-to-ico`
  are installed ad hoc rather than added to `web/package.json`, because nothing
  in the build invokes them and every `npm ci` (including the Dockerfile's)
  would pay for them.
- **Two things about those SVG sources are load-bearing and neither is about the
  drawing.** A double hyphen is illegal inside an XML comment, so the brand
  token is named `color-brand-600` without its leading dashes; and the comment
  sits *inside* the root element, because libvips sniffs for `<svg` near the
  start of the file and a comment block above it makes the file unreadable as
  an image. A browser tolerates both, which is why `public/favicon.svg` carried
  the first one for months without anyone noticing. librsvg refuses the file
  outright.
- **The brand color is written by hand in four SVG sources, and `make icons`
  refuses to run if they disagree.** There is nothing to derive from: the ramp
  exists only as `oklch()` custom properties in `index.css`, and neither a
  static SVG nor the manifest can read those without build tooling this project
  does not have. The first attempt at mitigating that was a prose inventory of
  which files hold the value — which is exactly what had already gone stale
  (`index.css` named `favicon.svg` alone, and was wrong within a release), so a
  second list would have been the same bet twice. `assertBrand` in
  `icons/generate.mjs` holds the values instead and exits non-zero naming the
  file that drifted. It cannot see `index.css`, so it catches the four copies
  diverging from each other rather than from the ramp — which is the failure
  that actually happens, someone updating two of four. The manifest is **not**
  a carrier: its colors are the stone grounds.
- **The manifest's `theme_color`/`background_color` are the *dark* ground, and
  one value is all it gets.** The `viewport` export in `app/layout.tsx` declares
  two media-scoped
  `theme-color` metas and Chrome honors those at runtime, but the manifest paints
  the launch splash before any of that is read. Light was the first choice and is
  the wrong one: it flashes white into a near-black app on every cold start for
  anyone whose device is dark. Dark loses less in reverse — the light theme is
  off-white, so the transition reads as the screen waking rather than as a flash.
- **`manifest.json` carries an explicit `id`.** Without it, identity is derived
  from `start_url`, so changing that later makes Chrome treat the app as a new
  one: existing installs are orphaned rather than updated, and a second copy
  appears alongside. Adding it afterwards does not repair those installs.
- **The manifest is `manifest.json`, not the spec's `site.webmanifest`.** The
  reason was a mime type: nginx shipped none for `.webmanifest` (it went out as
  `application/octet-stream`) and on App Platform the type was stamped at upload
  with no knob in `.do/app.yaml` to override it, so the spec extension meant
  patching the one stack where the problem was observable and leaving the stack
  that actually served users unverifiable — the two "need to agree", and that is
  how they quietly stop. Both of those servers are gone: Next serves `public/`
  on both stacks and answers `.json` as `application/json`. The name stays
  anyway, because it costs nothing, a browser parses a manifest regardless of
  its media type, and renaming it would orphan nothing but would put a
  `.webmanifest` back in front of whatever serves this next.
- **`lang` is two halves and shipping one of them is worse than shipping
  neither.** `<html lang>` said `el`, which had screen readers pronouncing the
  entire English interface as Greek. Flipping it to `en` is only correct
  *because* `SongDetailPage` now marks the song's own `lang={song.language}` on
  the title and the lyrics — the catalog's actual content, and mostly Greek.
  Flip one without the other and the bug moves rather than closes: the chrome
  gets its right voice and the lyrics, which are the reason the site exists,
  get the wrong one.
- **Titles come from `PageTitle`, which works because React 19 hoists a
  `<title>` out of the tree** — and, just as load-bearing, because
  `app/layout.tsx` declares no title for it to sort behind; see the bullet on
  that above. No effect, no library, and it unwinds on unmount
  — which is what stops the editor's name sticking to the song page it pops
  back to. Two shells cover most of the app in one line each: `AuthShell` names
  every auth screen from the `title` it already takes, so the steps of a reset
  are distinguishable in history despite being state rather than routes, and
  `AdminConsole` names itself from the tab matching the address, the same single
  source its heading uses. Pages that fetch a record render `<PageTitle />` with
  no name while in flight, on purpose: the alternative is a tab reading
  `undefined — Songfolio`.

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
- **The local insert is rolled back too, but only for the one failure that will
  never clear.** `ProvisionUser` upserts on `prelude_user_id`; `users.email` is
  `UNIQUE` and is *not* that conflict target, so a row holding the address under
  a different Prelude id raises a violation the upsert has no answer for, which
  the store reports as `ErrEmailTaken` rather than plain `ErrConflict`. The
  distinction is what the rollback hangs on. Any other store failure leaves the
  Prelude account alone on purpose — it is complete and usable, and the next
  sign-in provisions the local row just-in-time — but that promise is exactly
  what this case cannot keep, since just-in-time provisioning is the same
  statement failing the same way. Left in place, each attempt stacked another
  Prelude identity that could never sign in, and every later sign-in answered
  500 to an account with nothing wrong with it. **The row is never re-keyed onto
  the new id**, which is the repair that suggests itself and is not one: the
  address would inherit the old row's lists *and its role*. The address stays
  unusable until someone deals with the stale row by hand — a support matter with
  no safe automatic ending.
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
- **The manifest declares `display: standalone`,** so an installed copy runs
  without browser chrome. That is a navigation decision as much as a cosmetic
  one: it takes away the browser's Back button and, on iOS, the OS edge-swipe.
  What makes it safe is already in place and should stay — every screen carries
  the hamburger that opens the navigation, and `BackButton` covers both pages a
  reader navigates *into*. That is what `MenuBarLayout` is holding up in an
  installed window, where there is no browser chrome to fall back on: a screen
  that slipped through without a bar is merely awkward in Safari and is a dead
  end here. It replaced a bottom tab bar, which gave the same guarantee by
  position — which is why the bar is a layout route around a section and not a
  wrapper each screen has to be given. Note this does **not** make `lib/swipe.ts`'s edge guard
  redundant: it is moot only inside an installed window, and most readers arrive
  in a browser, where the guard is the whole reason a page swipe does not also
  trigger Safari's back gesture. Those numbers are pinned from both sides
  precisely so they cannot quietly shrink.
- **No service worker, so there is no automatic install prompt on Android.**
  Both platforms can install from a menu with the manifest alone, but Chrome's
  `beforeinstallprompt` additionally wants a service worker with a non-empty
  fetch handler. Adding one is not a small step: the document must never be
  cached, being what points at the current asset hashes, and a stale copy pins
  the browser to a deleted bundle. Next changes the shape of that problem
  without removing it — the document is server-rendered rather than a file, and
  Next already answers it `no-store`, so a service worker caching it is
  overriding a deliberate header rather than merely disagreeing with a build
  step.

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
- **A migration's backfill is run by no test, and the suite cannot see that it
  is not.** Migrations run once per test binary against an empty database, so
  every `UPDATE`/`INSERT … SELECT` that exists to fix up existing rows executes
  over zero of them and reports green. Migration 000010 shipped a backfill that
  aborted `CREATE UNIQUE INDEX` on perfectly ordinary data — two songs titled
  "Ο χωρισμός" and one titled "Ο χωρισμός 2", where the second's suffixed slug is
  the third's natural one — and nothing in the suite could have failed. The check
  is manual and belongs in the PR that adds the backfill: migrate a scratch
  database to the version *before* it, insert rows shaped like the ones in
  production, then migrate up. Anything a backfill and a trigger both compute
  must also come from one function, since the set-wise and row-wise forms of a
  rule are exactly where they diverge.
- **A migration edited after it has been applied does not re-run**, including
  against `lyrics_test_<binary>`. So a fix to SQL already recorded in
  `schema_migrations` passes against the old schema and says nothing; drop the
  test databases (or `make reset`) before believing a green run.
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
- The Management API key is server-side only. `PRELUDE_SDK_KEY` — reaching the
  build as `NEXT_PUBLIC_PRELUDE_SDK_KEY` — is a publishable client identifier
  and is safe in the bundle.
- Next only exposes `NEXT_PUBLIC_`-prefixed variables; `make web` maps
  `PRELUDE_APP_ID`, `PRELUDE_SDK_KEY`, `PRELUDE_SESSION_DOMAIN` and
  `PRELUDE_OTP_LOGIN_CONFIG_ID` across rather than keeping a second copy in
  `.env`. **Every mapping exists in four places** — `make web`, `make mobile`,
  `docker-compose.yml` (whose build args must match `web/Dockerfile`'s `ARG`/`ENV`
  pair) and `scripts/deploy-do.sh` — and a new variable is easy to add to only
  some of them. Only the deploy script complains, and for the SDK key it only
  *warns*: the others build happily with an empty value, so the failure is a
  screen that reports itself unconfigured on one stack while working on another.
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
these four are the parts that break quietly.

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
- **A production frontend build must leave `NEXT_PUBLIC_API_BASE_URL` unset**,
  which makes it call its own origin. Next inlines the value at build time, so
  setting it bakes in a hostname that a domain change then invalidates — and the
  failure appears only in the browser, long after a green deploy. Note "unset"
  and "empty" are different things and both are used: `make mobile` sets it
  *empty*, which `api/client.ts` distinguishes with `??` so the explicit empty
  string wins over the development fallback.
- **The `web` component is a service, not a static site, and `/api` can never
  reach it.** Next serves every document from a running process, so there is no
  `output_dir` and no `catchall_document`; the optional catch-all route under
  `src/app` is what answers the addresses the client-side router owns. The
  ingress gives `/api` to the Go service for the whole app, so a Next route
  handler under `app/api/` is unreachable in production while working perfectly
  in `next dev` — anything server-side the frontend needs must be mounted
  elsewhere.
- **`CLIENT_IP_HEADER` must be `DO-Connecting-IP` here, and must stay unset
  locally.** Registration is rate limited per caller, and behind the ingress the
  peer address is the ingress — so the whole world shared one bucket of five per
  minute, and the sixth honest sign-up anywhere was refused. **Not
  `X-Forwarded-For`**: App Platform documents that header as carrying its own
  ingress address rather than the caller's, so it is both forgeable in general
  and useless here in particular. The variable names the *one* header trusted to
  carry an address, which is what keeps trusting it a deployment's decision —
  anything a client can set turns a per-key limit into no limit at all, since a
  forged value per request buys a fresh bucket. A value that is missing or is not
  an address falls back to the peer, which is the safe direction: one shared
  bucket is stricter than a bucket per string a caller invents. Both directions
  are pinned by `TestClientIP`. Whether the ingress **overwrites** a
  client-supplied `DO-Connecting-IP` rather than appending to it was **never
  confirmed against a live request** — the documentation is the evidence. If it
  appends, the value arrives comma-joined, fails to parse and falls back to the
  peer, so the limit goes back to being global rather than becoming forgeable:
  the unconfirmed half can cost recall, never safety. Nothing in the logs would
  say so, either, since `httpx` logs `remote_addr` from `RemoteAddr` and so
  reports the ingress on every request whatever this is set to.

Migrations run from `cmd/migrate`, which embeds `backend/migrations` with
`go:embed` (hence `migrations/embed.go` — the directive cannot reach upward).
The tests still read the same files from disk, so editing SQL takes effect
without a rebuild. The API deliberately still does not migrate on boot.
