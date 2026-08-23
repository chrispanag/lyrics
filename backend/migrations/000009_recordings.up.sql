-- Recordings (εκτελέσεις): the performances of a song, each with its own
-- performers, YouTube link and year.
--
-- A song is a work — a title, lyrics, and the people who wrote them. Who
-- *performed* it, when, and where to watch it are properties of a recording,
-- and a Greek song typically has several. Before this migration the schema
-- could hold exactly one of each, so a song with three well-known recordings
-- had to pick one and discard the rest.
--
-- Two consequences shape everything below.
--
-- First, the `artist` and `performer` credit roles were describing a
-- performance, not the work, so they move to a recording and `song_credits`
-- narrows to composer and lyricist. The CHECK is tightened rather than left
-- permissive: an `artist` row written after this point would be attribution
-- that no screen reads and no search finds.
--
-- Second, `songs.youtube_url`, `songs.youtube_video_id` and
-- `songs.release_year` stay — as denormalized read-only copies of the *first*
-- recording, maintained by trigger exactly like `credits_text`. That is what
-- keeps the browse year filters, the catalog sort and the card's video badge
-- working without a single query changing. Nothing else may write them; see
-- refresh_songs_denorm below.

CREATE TABLE recordings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id           uuid        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,

  -- A short free-text name for the performance: the album it appeared on, or a
  -- descriptor like "Live στο Λυκαβηττό". Optional, because most recordings are
  -- identified by their performers and year alone.
  label             text,

  youtube_url       text,
  youtube_video_id  text,
  -- Mirrors songs.release_year's bound, since this is now where the year a
  -- reader sees actually comes from.
  release_year      int         CHECK (release_year BETWEEN 1000 AND 2200),
  notes             text,

  -- Whether this is the song's original recording. It is a claim about history,
  -- not a position: a contributor who does not know which came first leaves it
  -- false on all of them, and the ordering below falls back to the year.
  is_first          boolean     NOT NULL DEFAULT false,
  position          int         NOT NULL DEFAULT 0,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recordings_song_idx ON recordings (song_id, position);

-- At most one first recording per song. A partial unique index rather than a
-- CHECK, because the rule spans rows: a CHECK sees only the row being written
-- and would pass every second `true`.
CREATE UNIQUE INDEX recordings_one_first_per_song ON recordings (song_id) WHERE is_first;

CREATE TRIGGER recordings_set_updated_at
  BEFORE UPDATE ON recordings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The performers of one recording. No role column: everyone credited here
-- performed it, which is the whole distinction from song_credits.
--
-- person_id is RESTRICT for the same reason song_credits' is: deleting a person
-- must fail loudly rather than silently stripping attribution. The store maps
-- the violation to ErrInUse already, so this needs no Go change.
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

-- Recompute the denormalized columns, now five of them.
--
-- credits_text gains the recording performers, which is not optional: it feeds
-- the search vector at weight B and the trigram index behind fuzzy artist
-- matching, so leaving performers out would make every song findable by its
-- composer and none by the singer everybody knows it for.
--
-- The three first-recording copies are the second half. The ORDER BY is the
-- definition of "first" and it exists in exactly one other place — the
-- recordings query in attachRelations (backend/internal/store/songs.go), which
-- is what hands clients an already-ordered list so nothing re-derives the rule.
-- The two must agree; a test pins them against each other.
--
-- A song with no recordings yields no row from that sub-SELECT, and PostgreSQL
-- assigns NULL to all three targets. That is deliberate: removing a song's last
-- recording takes its year and video away, which is the truth about it.
CREATE OR REPLACE FUNCTION refresh_songs_denorm(p_song_ids uuid[]) RETURNS void
LANGUAGE sql AS $$
  UPDATE songs s SET
    credits_text = coalesce((
      SELECT string_agg(name, ' ' ORDER BY name)
      FROM (
        -- UNION, not UNION ALL: a person who both wrote and performed a song
        -- must appear once, which is what migration 000005 established and why
        -- it is restated here rather than nested.
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

-- recording_credits carries no song_id, so the song is resolved through
-- recordings. During a cascade the recording may already be gone and the lookup
-- comes back empty — which is correct, not a miss: the recordings trigger has
-- fired for that song already.
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

-- A renamed person must reindex the songs they appear on through *either*
-- table. Left reading song_credits alone, correcting a singer's spelling
-- silently failed to make them searchable under it.
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

CREATE TRIGGER recordings_denorm
  AFTER INSERT OR UPDATE OR DELETE ON recordings
  FOR EACH ROW EXECUTE FUNCTION songs_denorm_from_recordings();

CREATE TRIGGER recording_credits_denorm
  AFTER INSERT OR UPDATE OR DELETE ON recording_credits
  FOR EACH ROW EXECUTE FUNCTION songs_denorm_from_recording_credits();

-- Backfill: one first recording for every song that has anything
-- recording-shaped about it — performers, a link, or a year. A song with none
-- of the three gets no recording, because there would be nothing in it.
--
-- The functions above are already installed at this point, deliberately: the
-- DELETE further down fires the credits trigger for every moved row, and a
-- function that did not yet know about recordings would write a credits_text
-- with the performers missing. The final rebuild would repair it, but there is
-- no reason to pass through a wrong state on the way.
WITH source AS (
  SELECT s.id AS song_id, s.youtube_url, s.youtube_video_id, s.release_year
  FROM songs s
  WHERE s.youtube_url IS NOT NULL
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
-- A person credited as both artist and performer on one song is one performer:
-- the primary key is (recording_id, person_id) and would refuse the second row.
-- DISTINCT ON keeps the artist-role row, whose position is the stronger signal
-- of intended order.
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
  ORDER BY nr.id, sc.person_id, CASE sc.role WHEN 'artist' THEN 0 ELSE 1 END, sc.position
)
INSERT INTO recording_credits (recording_id, person_id, position)
SELECT recording_id,
       person_id,
       -- Renumbered densely from 0: the source positions were per-role, so an
       -- artist at 0 and a performer at 0 would both arrive as 0.
       row_number() OVER (PARTITION BY recording_id ORDER BY role_rank, old_position, name) - 1
FROM moved;

-- The second half of the move. Everything worth keeping is in
-- recording_credits now.
DELETE FROM song_credits WHERE role IN ('artist', 'performer');

-- Narrow song credits to authorship. The inline CHECK from 000002 took
-- PostgreSQL's default name.
ALTER TABLE song_credits DROP CONSTRAINT song_credits_role_check;
ALTER TABLE song_credits ADD CONSTRAINT song_credits_role_check
  CHECK (role IN ('composer', 'lyricist'));

-- Rebuild every row, so credits_text and the three first-recording columns are
-- right regardless of how the triggers above interleaved (000005 precedent).
SELECT refresh_songs_denorm(ARRAY(SELECT id FROM songs));
