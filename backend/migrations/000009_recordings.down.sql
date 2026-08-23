-- Reverse the recordings split, best effort.
--
-- Lossy by design, and the losses are worth naming: a song's second and later
-- recordings have nowhere to go, and neither do labels or per-recording notes.
-- What comes back is the first recording's performers, as `artist` credits,
-- which is the shape they had going in.
--
-- The order below matters. The CHECK has to be widened before 'artist' rows can
-- be written, and the old functions restored before the tables they do not
-- reference are dropped.

ALTER TABLE song_credits DROP CONSTRAINT song_credits_role_check;
ALTER TABLE song_credits ADD CONSTRAINT song_credits_role_check
  CHECK (role IN ('artist', 'composer', 'lyricist', 'performer'));

-- The first recording's performers become artist credits again. The ORDER BY is
-- the same "first" rule the up migration's function used.
--
-- songs.youtube_url, youtube_video_id and release_year need no copying back:
-- the trigger being dropped below kept them equal to this recording's values
-- all along, so dropping it simply freezes what is already there.
WITH firsts AS (
  SELECT DISTINCT ON (r.song_id) r.id, r.song_id
  FROM recordings r
  ORDER BY r.song_id, r.is_first DESC, r.release_year ASC NULLS LAST, r.position ASC, r.id
)
INSERT INTO song_credits (song_id, person_id, role, position)
SELECT f.song_id, rc.person_id, 'artist', rc.position
FROM firsts f
JOIN recording_credits rc ON rc.recording_id = f.id
ON CONFLICT (song_id, person_id, role) DO NOTHING;

-- Restore the 000005 body verbatim: song credits only, deduplicated, and no
-- first-recording copies to maintain.
CREATE OR REPLACE FUNCTION refresh_songs_denorm(p_song_ids uuid[]) RETURNS void
LANGUAGE sql AS $$
  UPDATE songs s SET
    credits_text = coalesce((
      SELECT string_agg(name, ' ' ORDER BY name)
      FROM (
        SELECT DISTINCT p.name
        FROM song_credits sc
        JOIN people p ON p.id = sc.person_id
        WHERE sc.song_id = s.id
      ) AS distinct_names
    ), ''),
    genres_text = coalesce((
      SELECT string_agg(g.name, ' ' ORDER BY g.name)
      FROM song_genres sg
      JOIN genres g ON g.id = sg.genre_id
      WHERE sg.song_id = s.id
    ), '')
  WHERE s.id = ANY (p_song_ids);
$$;

-- And the 000003 body, which knows only song_credits.
CREATE OR REPLACE FUNCTION songs_denorm_from_person_rename() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name THEN
    PERFORM refresh_songs_denorm(
      ARRAY(SELECT song_id FROM song_credits WHERE person_id = NEW.id)
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS recording_credits_denorm ON recording_credits;
DROP TRIGGER IF EXISTS recordings_denorm        ON recordings;
DROP FUNCTION IF EXISTS songs_denorm_from_recording_credits();
DROP FUNCTION IF EXISTS songs_denorm_from_recordings();

DROP TABLE IF EXISTS recording_credits;
DROP TABLE IF EXISTS recordings;

SELECT refresh_songs_denorm(ARRAY(SELECT id FROM songs));
