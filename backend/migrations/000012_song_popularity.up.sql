-- How often a song is opened, and how widely it is saved.
--
-- Clicks are openings of the song page. Anonymous and signed-in openings are
-- counted apart, and a repeat by the same actor inside 30 minutes is the same
-- visit (a refresh, or stepping away and straight back). list_adds is every
-- time the song has been placed in a list; a removal does not take that back.
-- list_users is how many people have it in a list right now.
--
-- score is the one ordering `sort=popularity` reads. A save outweighs a click,
-- and how many people saved it outweighs one person filing it into several
-- lists:
--
--   score = anon_clicks + user_clicks + 3 * list_adds + 10 * list_users
--
-- Nothing in Go writes these columns. Clicks go through record_song_click, and
-- the list trigger below maintains the save counts, including when a list or
-- its owner is deleted.

CREATE TABLE song_popularity (
  song_id      uuid PRIMARY KEY REFERENCES songs (id) ON DELETE CASCADE,
  anon_clicks  integer NOT NULL DEFAULT 0 CHECK (anon_clicks >= 0),
  user_clicks  integer NOT NULL DEFAULT 0 CHECK (user_clicks >= 0),
  list_adds    integer NOT NULL DEFAULT 0 CHECK (list_adds >= 0),
  list_users   integer NOT NULL DEFAULT 0 CHECK (list_users >= 0),
  score        integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The popularity ordering. Title and id, the tie-break, live on songs, so this
-- index gets the ranking as far as the score; the rest is a handful of ties.
CREATE INDEX song_popularity_score_idx ON song_popularity (score DESC, song_id);

-- One row per actor per song: the dedupe, not the tally. actor_key is
-- 'user:<uuid>' or 'anon:<uuid>', built by the store. Not a user foreign key,
-- so deleting an account keeps the clicks it already contributed.
CREATE TABLE song_clicks (
  song_id         uuid        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  actor_key       text        NOT NULL CHECK (length(actor_key) > 0),
  authenticated   boolean     NOT NULL,
  last_counted_at timestamptz NOT NULL,
  PRIMARY KEY (song_id, actor_key)
);

CREATE OR REPLACE FUNCTION song_popularity_score(
  anon_clicks integer,
  user_clicks integer,
  list_adds integer,
  list_users integer
) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT anon_clicks + user_clicks + 3 * list_adds + 10 * list_users;
$$;

COMMENT ON FUNCTION song_popularity_score(integer, integer, integer, integer) IS
  'The sort=popularity key. A click counts 1, a list placement 3, and a person '
  'who currently has the song in a list 10. Change the tests that pin the totals '
  'when these weights change.';

-- Records one opening. NULL when the song does not exist, false when this actor
-- already opened it inside the visit window, true when the tally moved.
CREATE OR REPLACE FUNCTION record_song_click(
  p_song_id uuid,
  p_actor_key text,
  p_authenticated boolean
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  counted boolean;
  anon_inc integer := CASE WHEN p_authenticated THEN 0 ELSE 1 END;
  user_inc integer := CASE WHEN p_authenticated THEN 1 ELSE 0 END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM songs WHERE id = p_song_id) THEN
    RETURN NULL;
  END IF;

  -- The WHERE is what makes a repeat inside the window a no-op: the conflict
  -- updates nothing, RETURNING yields no row, and the tally is left alone.
  INSERT INTO song_clicks (song_id, actor_key, authenticated, last_counted_at)
  VALUES (p_song_id, p_actor_key, p_authenticated, now())
  ON CONFLICT (song_id, actor_key) DO UPDATE
    SET last_counted_at = now(),
        authenticated = EXCLUDED.authenticated
    WHERE song_clicks.last_counted_at < now() - interval '30 minutes'
  RETURNING true INTO counted;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO song_popularity AS sp (song_id, anon_clicks, user_clicks, score)
  VALUES (
    p_song_id,
    anon_inc,
    user_inc,
    song_popularity_score(anon_inc, user_inc, 0, 0)
  )
  ON CONFLICT (song_id) DO UPDATE SET
    anon_clicks = sp.anon_clicks + anon_inc,
    user_clicks = sp.user_clicks + user_inc,
    score = song_popularity_score(
      sp.anon_clicks + anon_inc,
      sp.user_clicks + user_inc,
      sp.list_adds,
      sp.list_users),
    updated_at = now();

  RETURN true;
END;
$$;

-- list_adds counts placements ever; list_users is who has it saved right now.
-- A no-op re-add (ON CONFLICT DO NOTHING) does not fire this, so it does not
-- count twice. Copying a list does insert, and counts for the new owner.
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

CREATE TRIGGER list_items_popularity
  AFTER INSERT OR DELETE ON list_items
  FOR EACH ROW EXECUTE FUNCTION song_popularity_from_list_item();

-- What is already saved counts. There is no history of removals before this
-- migration, so the current placements are the starting tally.
INSERT INTO song_popularity (song_id, list_adds, list_users, score)
SELECT
  li.song_id,
  count(*)::integer,
  count(DISTINCT l.owner_id)::integer,
  song_popularity_score(0, 0, count(*)::integer, count(DISTINCT l.owner_id)::integer)
FROM list_items li
JOIN lists l ON l.id = li.list_id
GROUP BY li.song_id;
