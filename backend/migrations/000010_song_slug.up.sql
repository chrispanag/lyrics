-- A song is addressed by its name, not by its identifier.
--
-- `/songs/6f2a1c3e-9b04-…` says nothing to a reader, nothing to a search engine
-- and nothing in a shared link. This adds the column that replaces it, and the
-- three rules that keep it honest.
--
-- **The slug is written by the trigger at the bottom and by nothing else.** That
-- is the same arrangement `credits_text` and the first-recording copies already
-- have, and it is what makes the two rules below structural rather than
-- something every future writer has to remember:
--
--   1. It is assigned BEFORE INSERT and never on UPDATE, so correcting a title
--      cannot move a song's address out from under a bookmark. UpdateGenre
--      leaves a genre's slug alone for exactly this reason and says so; here the
--      trigger is what says it, so there is no `UPDATE songs SET slug` to
--      forget about.
--   2. `CreateSong`, `UpdateSong` and the importer's own INSERT all name their
--      columns explicitly and none of them names this one, so none of them
--      needed changing — including the importer, which bypasses the store.
--
-- The one thing the trigger does honor is a slug that is already there: a
-- restored dump inserts rows with their slugs, and recomputing them would break
-- every link the dump was taken to preserve. Nothing in the API can reach that
-- path — neither SongInput nor songRequest has the field, and DecodeJSON
-- refuses unknown ones.

-- app_slugify is a deliberate mirror of store.Slugify (Go), the way app_norm
-- mirrors what the app_simple configuration does to raw text. It exists because
-- the backfill below has to run inside this migration, and because Greek titles
-- transliterate rather than fold: without the map, "Έντεχνο" strips to "Εντεχνο"
-- and slugifies to nothing at all, so most of this catalog would have no address.
--
-- The two must not drift. TestSongSlugMatchesSlugify runs a table of inputs
-- through both and asserts they agree case by case — inputs rather than expected
-- strings, so it covers the ground where the two could diverge rather than
-- restating what either produces. One class of divergence is known and accepted:
-- unaccent expands a few Latin characters that Go only strips, so "Straße"
-- slugifies to `strasse` here and `stra-e` there. Nothing in this catalog
-- reaches it, and closing it would mean either chasing unaccent.rules from Go or
-- changing how a genre's slug is derived, which is a different decision.
--
-- Everything is schema-qualified: this is called from a trigger and from the
-- backfill, and an unqualified `unaccent(...)` resolves in an ordinary query and
-- then fails under a restricted search_path.
CREATE OR REPLACE FUNCTION app_slugify(txt text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT trim(both '-' from regexp_replace(
    translate(
      -- θ, χ and ψ are the three letters with no single-character Latin form,
      -- so they are replaced before translate rather than inside it. Their
      -- output is ASCII, which translate then leaves alone.
      -- Lowercase and strip diacritics is app_norm's whole job, including the
      -- explicit regdictionary cast that is what lets it be IMMUTABLE and the
      -- schema qualification 000001 spends twenty lines explaining. Reusing it
      -- couples the two, deliberately: app_norm must stay equivalent to what
      -- app_simple does to raw text, and if that ever forces a change here it
      -- turns TestSongSlugMatchesSlugify red rather than quietly minting
      -- different slugs.
      replace(replace(replace(
        public.app_norm(txt),
      'θ', 'th'), 'χ', 'ch'), 'ψ', 'ps'),
      'αβγδεζηικλμνξοπρσςτυφω',
      'avgdeziiklmnxoprsstyfo'),
    '[^a-z0-9]+', '-', 'g'));
$$;

COMMENT ON FUNCTION app_slugify(text) IS
  'URL-safe slug from a display name, transliterating Greek. Must stay equivalent to '
  'store.Slugify in Go, which TestSongSlugMatchesSlugify asserts. Returns '''' when a '
  'name has no usable characters; callers must handle that.';

-- Two slugs a song may not hold, for reasons that have nothing to do with how
-- it reads.
--
-- `new` is the editor's own address (`/songs/new`), and both routers rank a
-- static segment above a dynamic one — so a song slugged `new` would be
-- permanently unreachable, its address opening a blank editor instead.
--
-- A UUID-shaped slug is the other. `GET /songs/{ref}` parses a UUID first and
-- falls back to a slug lookup, and the CHECK below happily accepts
-- `6f2a1c3e-9b04-4d21-8f77-1a2b3c4d5e6f` as a well-formed slug — so a song
-- titled that would be shadowed by whatever song holds the id. Refusing to mint
-- one keeps the resolver's precedence unambiguous without a second regex living
-- in the Go code.
--
-- It takes *two* patterns, because `uuid.Parse` accepts two spellings a slug
-- could also spell: the dashed canonical form and the same 32 hex digits with
-- the dashes left out. The undashed one is what a check written from the
-- canonical form misses, and it is a perfectly legal slug — a title of 32
-- characters drawn from a-f and 0-9 would resolve as an identifier and never
-- reach the row it names. Both are suffixed instead, and the suffix puts a dash
-- where neither form allows one, so the result cannot parse as a UUID either.
CREATE OR REPLACE FUNCTION app_song_slug_reserved(slug text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT slug = 'new'
      OR slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR slug ~ '^[0-9a-f]{32}$';
$$;

ALTER TABLE songs ADD COLUMN slug text;

-- The base a title wants, before anything is known about who already holds it.
--
-- A title of punctuation alone slugifies to nothing. It still needs an address,
-- so it gets the generic base and then the same numbering as everything else.
CREATE OR REPLACE FUNCTION app_song_slug_base(title text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT coalesce(nullif(app_slugify(title), ''), 'song');
$$;

-- The first address a song may actually hold: the base, then `-2`, `-3`, …,
-- skipping the reserved forms and anything already taken.
--
-- One function rather than two implementations, because the backfill below and
-- the trigger at the bottom have to produce the same sequence. Written set-wise
-- they do not, and the failure is not a wrong slug but a migration that will not
-- apply: numbering within a title's own group gives two songs called
-- "Ο χωρισμός" the addresses `o-chorismos` and `o-chorismos-2`, and then hands
-- `o-chorismos-2` to a song called "Ο χωρισμός 2" as its *unsuffixed* base — one
-- address on two rows, and CREATE UNIQUE INDEX below aborting on a catalog that
-- looks perfectly ordinary. Only asking the table, one row at a time, cannot do
-- that.
--
-- VOLATILE (the default) on purpose: it reads `songs`, so the planner must not
-- be told its answer can be folded or reused.
CREATE OR REPLACE FUNCTION app_song_free_slug(base text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  candidate text := base;
  n         int  := 1;
BEGIN
  WHILE app_song_slug_reserved(candidate)
        OR EXISTS (SELECT 1 FROM songs WHERE slug = candidate) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END;
$$;

-- Backfill, before the trigger exists so it does not fire once per row.
--
-- One row at a time and through the same function the trigger uses, for the
-- reason written above it. Ordered by created_at then id, so the oldest song
-- keeps the clean address and a re-run of this migration on the same data
-- produces the same slugs.
--
-- Titles are not unique in this catalog and were never meant to be — the
-- importer counts seven groups of distinct songs sharing one — so the suffix is
-- the ordinary case here rather than an edge one.
--
-- `songs_set_updated_at` is switched off around it. Every song in the catalog is
-- written here, so left on, the migration would stamp the whole table with the
-- moment it ran — throwing away when each song was last actually edited, in one
-- statement and with nothing to recover it from.
ALTER TABLE songs DISABLE TRIGGER songs_set_updated_at;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM songs ORDER BY created_at, id LOOP
    UPDATE songs SET slug = app_song_free_slug(app_song_slug_base(title))
    WHERE id = r.id;
  END LOOP;
END;
$$;

ALTER TABLE songs ENABLE TRIGGER songs_set_updated_at;

ALTER TABLE songs ALTER COLUMN slug SET NOT NULL;

-- The same shape genres.slug carries, so the two read alike.
ALTER TABLE songs ADD CONSTRAINT songs_slug_check
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Named rather than inline, so isUniqueViolation can ask about this index by
-- name: a song insert can violate this one and no other, but that is a property
-- of today's schema rather than a promise.
CREATE UNIQUE INDEX songs_slug_key ON songs (slug);

COMMENT ON COLUMN songs.slug IS
  'The song''s address. Assigned from the title on insert and never recomputed, so a '
  'retitle cannot move a bookmarked URL. Written by songs_set_slug and by nothing else.';

CREATE OR REPLACE FUNCTION songs_assign_slug() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base text;
BEGIN
  -- A slug that arrived with the row is kept: that is a restored dump, and
  -- recomputing would break the links the dump exists to preserve. Only NULL is
  -- treated as absent — an explicit '' is refused by the CHECK rather than
  -- quietly fixed up, which is the honest direction for a value nothing in this
  -- application can produce.
  IF NEW.slug IS NOT NULL THEN
    RETURN NEW;
  END IF;

  base := app_song_slug_base(NEW.title);

  -- Two transactions inserting the same title would otherwise both read the
  -- same free suffix and one would lose on the unique index — surfacing as a
  -- 409 saying the song already exists, which is wrong advice when two songs
  -- sharing a title is ordinary. The lock is per base slug and held to the end
  -- of the transaction, so it serializes only the writes that would collide.
  --
  -- It is taken here rather than inside app_song_free_slug because the backfill
  -- calls that function once per song and would then hold one lock per distinct
  -- title until the migration commits — thousands of them, to serialize against
  -- nobody, since it already holds the table.
  PERFORM pg_advisory_xact_lock(hashtext('songs.slug:' || base));

  NEW.slug := app_song_free_slug(base);
  RETURN NEW;
END;
$$;

-- BEFORE INSERT only. An UPDATE trigger here would be the retitle moving the
-- address, which is the whole thing this column is arranged to prevent.
CREATE TRIGGER songs_set_slug
  BEFORE INSERT ON songs
  FOR EACH ROW EXECUTE FUNCTION songs_assign_slug();
