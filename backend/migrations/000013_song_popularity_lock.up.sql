-- Two placements of the same song committed side by side used to lose one.
-- Each read list_adds and counted the people holding the song from its own
-- snapshot, and the second write replaced the first instead of adding to it:
-- one placement, and perhaps one person, went missing until the next change.
--
-- The tally's row is now locked first, and list_adds moves by a delta under
-- that lock. A concurrent placement waits there for the other to commit, and
-- the count that follows is a new statement, so it sees the other's row.

CREATE OR REPLACE FUNCTION song_popularity_from_list_item() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid   uuid := COALESCE(NEW.song_id, OLD.song_id);
  added integer := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE 0 END;
  users integer;
BEGIN
  -- The song is going away with this row. Its popularity goes with it.
  IF NOT EXISTS (SELECT 1 FROM songs WHERE id = sid) THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO song_popularity AS sp (song_id, list_adds, score)
    VALUES (sid, added, song_popularity_score(0, 0, added, 0))
    ON CONFLICT (song_id) DO UPDATE SET
      list_adds = sp.list_adds + added,
      updated_at = now();

    SELECT count(DISTINCT l.owner_id)::integer
    INTO users
    FROM list_items li
    JOIN lists l ON l.id = li.list_id
    WHERE li.song_id = sid;

    UPDATE song_popularity SET
      list_users = users,
      score = song_popularity_score(anon_clicks, user_clicks, list_adds, users),
      updated_at = now()
    WHERE song_id = sid;
  EXCEPTION
    -- Deleting the song cascades here. Inserting a popularity row then would
    -- reference a song mid-delete; that failure is the song leaving.
    WHEN foreign_key_violation THEN
      NULL;
  END;

  RETURN NULL;
END;
$$;
