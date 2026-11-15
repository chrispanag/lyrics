-- A song is addressed by its name, not by its identifier.
--
-- The slug is written by the BEFORE INSERT trigger at the bottom and by nothing
-- else, never on UPDATE, so a retitle cannot move a bookmarked address. A slug
-- already on the row (a restored dump) is kept. See CLAUDE.md, "Song addresses".

-- Mirrors store.Slugify (Go); change both. TestSongSlugMatchesSlugify asserts
-- they agree. Greek is transliterated, not folded, or it slugifies to nothing.
-- Known divergence: unaccent expands "ß" to "ss" where Go strips it.
-- Schema-qualified for the restricted search_path.
CREATE OR REPLACE FUNCTION app_slugify(txt text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT trim(both '-' from regexp_replace(
    translate(
      -- θ, χ and ψ have no single-letter Latin form, so they are replaced
      -- before translate. Built on app_norm deliberately: a change there turns
      -- TestSongSlugMatchesSlugify red instead of minting different slugs.
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

-- Reserved slugs. `new` is the editor's address and outranks a dynamic segment.
-- UUID-shaped slugs would be shadowed by the resolver, which tries a UUID first;
-- `uuid.Parse` accepts both the dashed and the 32-hex-digit form, so both are
-- refused. A suffix makes either unparseable as a UUID.
CREATE OR REPLACE FUNCTION app_song_slug_reserved(slug text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT slug = 'new'
      OR slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR slug ~ '^[0-9a-f]{32}$';
$$;

ALTER TABLE songs ADD COLUMN slug text;

-- The base a title wants; a title that slugifies to nothing gets `song`.
CREATE OR REPLACE FUNCTION app_song_slug_base(title text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT coalesce(nullif(app_slugify(title), ''), 'song');
$$;

-- The first address a song may actually hold: the base, then `-2`, `-3`, …,
-- skipping the reserved forms and anything already taken.
--
-- Shared by the backfill and the trigger, and row-at-a-time on purpose: a
-- set-wise numbering can hand "Ο χωρισμός 2" the `o-chorismos-2` already given
-- to a second "Ο χωρισμός", aborting CREATE UNIQUE INDEX below.
--
-- VOLATILE (the default) on purpose: it reads `songs`.
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
-- Ordered by created_at then id, so the oldest song keeps the clean address and
-- a re-run on the same data produces the same slugs.
--
-- `songs_set_updated_at` is off around it, or every song's updated_at would be
-- overwritten with the migration's time.
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

CREATE UNIQUE INDEX songs_slug_key ON songs (slug);

COMMENT ON COLUMN songs.slug IS
  'The song''s address. Assigned from the title on insert and never recomputed, so a '
  'retitle cannot move a bookmarked URL. Written by songs_set_slug and by nothing else.';

CREATE OR REPLACE FUNCTION songs_assign_slug() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  base text;
BEGIN
  -- A slug that arrived with the row (a restored dump) is kept. Only NULL is
  -- absent; an explicit '' is left for the CHECK to refuse.
  IF NEW.slug IS NOT NULL THEN
    RETURN NEW;
  END IF;

  base := app_song_slug_base(NEW.title);

  -- Serializes concurrent inserts of one base slug, which would otherwise pick
  -- the same suffix and fail on the unique index as a misleading 409. Taken here,
  -- not in app_song_free_slug, so the backfill does not hold a lock per title.
  PERFORM pg_advisory_xact_lock(hashtext('songs.slug:' || base));

  NEW.slug := app_song_free_slug(base);
  RETURN NEW;
END;
$$;

-- BEFORE INSERT only: on UPDATE a retitle would move the address.
CREATE TRIGGER songs_set_slug
  BEFORE INSERT ON songs
  FOR EACH ROW EXECUTE FUNCTION songs_assign_slug();
