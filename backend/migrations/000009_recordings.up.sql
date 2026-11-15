-- Recordings (εκτελέσεις): the performances of a song, each with its own
-- performers, YouTube link and year.
--
-- A song is the work; performers, year and link belong to a recording, and a
-- song may have several.
--
-- The `artist` and `performer` roles move to recordings, and `song_credits`
-- narrows to composer and lyricist.
--
-- `songs.youtube_url`, `youtube_video_id` and `release_year` stay as
-- trigger-maintained copies of the *first* recording. Nothing else may write
-- them; see CLAUDE.md, "Recordings".

CREATE TABLE recordings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id           uuid        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,

  -- Optional free-text name: an album, or "Live στο Λυκαβηττό".
  label             text,

  youtube_url       text,
  youtube_video_id  text,
  -- Same bound as songs.release_year.
  release_year      int         CHECK (release_year BETWEEN 1000 AND 2200),
  notes             text,

  -- A claim about history, not a position: may be false on every recording,
  -- and the ordering below then falls back to the year.
  is_first          boolean     NOT NULL DEFAULT false,
  position          int         NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recordings_song_idx ON recordings (song_id, position);

-- At most one first recording per song. Not a CHECK: the rule spans rows.
CREATE UNIQUE INDEX recordings_one_first_per_song ON recordings (song_id) WHERE is_first;

CREATE TRIGGER recordings_set_updated_at
  BEFORE UPDATE ON recordings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The performers of one recording; no role column. person_id is RESTRICT like
-- song_credits', so deleting a credited person fails rather than stripping
-- attribution.
CREATE TABLE recording_credits (
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES people (id)     ON DELETE RESTRICT,
  position     int  NOT NULL DEFAULT 0,
  PRIMARY KEY (recording_id, person_id)
);

CREATE INDEX recording_credits_person_idx ON recording_credits (person_id);

COMMENT ON TABLE recordings IS
  'Performances of a song (εκτελέσεις). Owns the YouTube link and year; songs.* carries a trigger-maintained copy of the first one.';
COMMENT ON COLUMN recordings.is_first IS
  'Marks the original recording. Historical claim, not ordering — see refresh_songs_denorm for how "first" is resolved when unset.';
COMMENT ON TABLE recording_credits IS
  'Performers of a recording. Roleless by design: song_credits holds authorship, this holds performance.';

-- credits_text must include recording performers, or fuzzy artist search
-- cannot find a song by its singer.
--
-- The ORDER BY defines "first" and must match the recordings query in
-- attachRelations (backend/internal/store/songs.go);
-- TestFirstRecordingRuleHasOneAuthority pins them.
--
-- A song with no recordings gets NULL in all three copies, deliberately.
CREATE OR REPLACE FUNCTION refresh_songs_denorm(p_song_ids uuid[]) RETURNS void
LANGUAGE sql AS $$
  UPDATE songs s SET
    credits_text = coalesce((
      SELECT string_agg(name, ' ' ORDER BY name)
      FROM (
        -- UNION, not UNION ALL: someone who wrote and performed a song is one name.
        SELECT p.name
        FROM song_credits sc
        JOIN people p ON p.id = sc.person_id
        WHERE sc.song_id = s.id
        UNION
        SELECT p.name
        FROM recordings r
        JOIN recording_credits rc ON rc.recording_id = r.id
        JOIN people p             ON p.id = rc.person_id
        WHERE r.song_id = s.id
      ) AS distinct_names
    ), ''),
    genres_text = coalesce((
      SELECT string_agg(g.name, ' ' ORDER BY g.name)
      FROM song_genres sg
      JOIN genres g ON g.id = sg.genre_id
      WHERE sg.song_id = s.id
    ), ''),
    (youtube_url, youtube_video_id, release_year) = (
      SELECT r.youtube_url, r.youtube_video_id, r.release_year
      FROM recordings r
      WHERE r.song_id = s.id
      ORDER BY r.is_first DESC, r.release_year ASC NULLS LAST, r.position ASC, r.id
      LIMIT 1
    )
  WHERE s.id = ANY (p_song_ids);
$$;

-- Recording added, removed, or moved to a different song.
CREATE OR REPLACE FUNCTION songs_denorm_from_recordings() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF TG_OP <> 'INSERT' THEN ids := ids || OLD.song_id; END IF;
  IF TG_OP <> 'DELETE' THEN ids := ids || NEW.song_id; END IF;
  PERFORM refresh_songs_denorm(ids);
  RETURN NULL;
END;
$$;

-- The song is resolved through recordings. During a cascade the recording may
-- already be gone; that is fine, since the recordings trigger has fired.
CREATE OR REPLACE FUNCTION songs_denorm_from_recording_credits() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF TG_OP <> 'INSERT' THEN rids := rids || OLD.recording_id; END IF;
  IF TG_OP <> 'DELETE' THEN rids := rids || NEW.recording_id; END IF;
  PERFORM refresh_songs_denorm(ARRAY(
    SELECT DISTINCT song_id FROM recordings WHERE id = ANY (rids)
  ));
  RETURN NULL;
END;
$$;

-- A rename must reindex songs through *both* tables, or a corrected singer's
-- spelling never becomes searchable.
CREATE OR REPLACE FUNCTION songs_denorm_from_person_rename() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name THEN
    PERFORM refresh_songs_denorm(ARRAY(
      SELECT song_id FROM song_credits WHERE person_id = NEW.id
      UNION
      SELECT r.song_id
      FROM recording_credits rc
      JOIN recordings r ON r.id = rc.recording_id
      WHERE rc.person_id = NEW.id
    ));
  END IF;
  RETURN NULL;
END;
$$;

-- Backfill: one first recording for every song with performers, a link, or a
-- year.
--
-- The functions above are installed first so the DELETE below, which fires the
-- credits trigger, already writes performers into credits_text. The new
-- tables' triggers are created after this block: row by row they would only
-- duplicate the final rebuild, and the file runs as one transaction.
--
-- youtube_video_id is in the predicate too: an id without a URL would
-- otherwise get no recording and be nulled by the rebuild.
WITH source AS (
  SELECT s.id AS song_id, s.youtube_url, s.youtube_video_id, s.release_year
  FROM songs s
  WHERE s.youtube_url IS NOT NULL
     OR s.youtube_video_id IS NOT NULL
     OR s.release_year IS NOT NULL
     OR EXISTS (
          SELECT 1 FROM song_credits sc
          WHERE sc.song_id = s.id AND sc.role IN ('artist', 'performer')
        )
),
new_recordings AS (
  INSERT INTO recordings (song_id, youtube_url, youtube_video_id, release_year, is_first, position)
  SELECT song_id, youtube_url, youtube_video_id, release_year, true, 0
  FROM source
  RETURNING id, song_id
),
-- An artist-and-performer on one song is one performer (the primary key would
-- refuse a second row). DISTINCT ON keeps the artist row's position.
moved AS (
  SELECT DISTINCT ON (nr.id, sc.person_id)
         nr.id AS recording_id,
         sc.person_id,
         CASE sc.role WHEN 'artist' THEN 0 ELSE 1 END AS role_rank,
         sc.position AS old_position,
         p.name
  FROM new_recordings nr
  JOIN song_credits sc ON sc.song_id = nr.song_id AND sc.role IN ('artist', 'performer')
  JOIN people p        ON p.id = sc.person_id
  -- role_rank, not a copy of the CASE: row_number() below must order the same way.
  ORDER BY nr.id, sc.person_id, role_rank, sc.position
)
INSERT INTO recording_credits (recording_id, person_id, position)
SELECT recording_id,
       person_id,
       -- Renumbered densely from 0: the source positions were per-role, so an
       -- artist at 0 and a performer at 0 would both arrive as 0.
       row_number() OVER (PARTITION BY recording_id ORDER BY role_rank, old_position, name) - 1
FROM moved;

DELETE FROM song_credits WHERE role IN ('artist', 'performer');

-- Narrow song credits to authorship. The inline CHECK from 000002 took
-- PostgreSQL's default name.
ALTER TABLE song_credits DROP CONSTRAINT song_credits_role_check;
ALTER TABLE song_credits ADD CONSTRAINT song_credits_role_check
  CHECK (role IN ('composer', 'lyricist'));

CREATE TRIGGER recordings_denorm
  AFTER INSERT OR UPDATE OR DELETE ON recordings
  FOR EACH ROW EXECUTE FUNCTION songs_denorm_from_recordings();

CREATE TRIGGER recording_credits_denorm
  AFTER INSERT OR UPDATE OR DELETE ON recording_credits
  FOR EACH ROW EXECUTE FUNCTION songs_denorm_from_recording_credits();

-- Rebuild every row; this also stands in for the trigger firings skipped above.
SELECT refresh_songs_denorm(ARRAY(SELECT id FROM songs));
