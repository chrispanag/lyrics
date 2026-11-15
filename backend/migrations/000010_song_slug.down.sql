-- Drop the song address. Lossy: every `/songs/<slug>` link stops resolving, and
-- re-applying the up migration may assign different suffixes.
--
-- Nothing else uses these functions; genres slugify in Go.

DROP TRIGGER IF EXISTS songs_set_slug ON songs;
DROP FUNCTION IF EXISTS songs_assign_slug();

DROP INDEX IF EXISTS songs_slug_key;
ALTER TABLE songs DROP CONSTRAINT IF EXISTS songs_slug_check;
ALTER TABLE songs DROP COLUMN IF EXISTS slug;

DROP FUNCTION IF EXISTS app_song_free_slug(text);
DROP FUNCTION IF EXISTS app_song_slug_base(text);
DROP FUNCTION IF EXISTS app_song_slug_reserved(text);
DROP FUNCTION IF EXISTS app_slugify(text);
