-- Reverse the recordings split, best effort.
--
-- Lossy: later recordings, labels and per-recording notes are dropped. The
-- first recording's performers come back as `artist` credits.
--
-- Order matters: widen the CHECK before writing 'artist' rows, and restore the
-- old functions before dropping the tables.

ALTER TABLE song_credits DROP CONSTRAINT song_credits_role_check;
ALTER TABLE song_credits ADD CONSTRAINT song_credits_role_check
  CHECK (role IN ('artist', 'composer', 'lyricist', 'performer'));

-- Same "first" ORDER BY as the up migration. songs.youtube_url,
-- youtube_video_id and release_year already hold this recording's values.
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
