-- The function as migration 000012 wrote it.

CREATE OR REPLACE FUNCTION song_popularity_from_list_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid   uuid := COALESCE(NEW.song_id, OLD.song_id);
  adds  integer;
  users integer;
BEGIN
  SELECT
    COALESCE(sp.list_adds, 0) + CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE 0 END,
    (
      SELECT count(DISTINCT l.owner_id)::integer
      FROM list_items li
      JOIN lists l ON l.id = li.list_id
      WHERE li.song_id = sid
    )
  INTO adds, users
  FROM songs s
  LEFT JOIN song_popularity sp ON sp.song_id = s.id
  WHERE s.id = sid;

  -- The song is going away with this row. Its popularity goes with it.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO song_popularity (song_id, list_adds, list_users, score)
    VALUES (sid, adds, users, song_popularity_score(0, 0, adds, users))
    ON CONFLICT (song_id) DO UPDATE SET
      list_adds = EXCLUDED.list_adds,
      list_users = EXCLUDED.list_users,
      score = song_popularity_score(
        song_popularity.anon_clicks,
        song_popularity.user_clicks,
        EXCLUDED.list_adds,
        EXCLUDED.list_users),
      updated_at = now();
  EXCEPTION
    -- Deleting the song cascades here. Inserting a popularity row then would
    -- reference a song mid-delete; that failure is the song leaving.
    WHEN foreign_key_violation THEN
      NULL;
  END;

  RETURN NULL;
END;
$$;
