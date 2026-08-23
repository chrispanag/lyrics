-- Drop the song address. Lossy in the one way that matters: every slug goes,
-- so every `/songs/<slug>` link that was shared while this was applied stops
-- resolving. Re-applying the up migration does not recover them — the backfill
-- derives from the title, and any suffix a collision produced depends on the
-- row order at the time.
--
-- app_slugify is dropped with it, along with the three helpers around it.
-- Nothing else uses any of them; genres slugify in Go.

DROP TRIGGER IF EXISTS songs_set_slug ON songs;
DROP FUNCTION IF EXISTS songs_assign_slug();

DROP INDEX IF EXISTS songs_slug_key;
ALTER TABLE songs DROP CONSTRAINT IF EXISTS songs_slug_check;
ALTER TABLE songs DROP COLUMN IF EXISTS slug;

DROP FUNCTION IF EXISTS app_song_free_slug(text);
DROP FUNCTION IF EXISTS app_song_slug_base(text);
DROP FUNCTION IF EXISTS app_song_slug_reserved(text);
DROP FUNCTION IF EXISTS app_slugify(text);
