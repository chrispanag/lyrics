-- Weighted search index over songs, plus the triggers that keep the
-- denormalized credit and genre text in sync with the join tables.

-- Recomputes both denormalized columns for the given songs. Recomputing both
-- when only one changed costs a negligible amount at this scale and removes any
-- chance of the two paths drifting apart.
CREATE OR REPLACE FUNCTION refresh_songs_denorm(p_song_ids uuid[]) RETURNS void
LANGUAGE sql AS $$
  UPDATE songs s SET
    credits_text = coalesce((
      SELECT string_agg(p.name, ' ' ORDER BY sc.role, sc.position, p.name)
      FROM song_credits sc
      JOIN people p ON p.id = sc.person_id
      WHERE sc.song_id = s.id
    ), ''),
    genres_text = coalesce((
      SELECT string_agg(g.name, ' ' ORDER BY g.name)
      FROM song_genres sg
      JOIN genres g ON g.id = sg.genre_id
      WHERE sg.song_id = s.id
    ), '')
  WHERE s.id = ANY (p_song_ids);
$$;

-- Credit added, removed, or moved to a different song.
CREATE OR REPLACE FUNCTION songs_denorm_from_credits() RETURNS trigger
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

CREATE OR REPLACE FUNCTION songs_denorm_from_genres() RETURNS trigger
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

-- Renaming a person or genre must reindex every song that references it,
-- otherwise a corrected artist spelling would never become searchable.
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

CREATE OR REPLACE FUNCTION songs_denorm_from_genre_rename() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name THEN
    PERFORM refresh_songs_denorm(
      ARRAY(SELECT song_id FROM song_genres WHERE genre_id = NEW.id)
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER song_credits_denorm
  AFTER INSERT OR UPDATE OR DELETE ON song_credits
  FOR EACH ROW EXECUTE FUNCTION songs_denorm_from_credits();

CREATE TRIGGER song_genres_denorm
  AFTER INSERT OR UPDATE OR DELETE ON song_genres
  FOR EACH ROW EXECUTE FUNCTION songs_denorm_from_genres();

CREATE TRIGGER people_rename_denorm
  AFTER UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION songs_denorm_from_person_rename();

CREATE TRIGGER genres_rename_denorm
  AFTER UPDATE ON genres
  FOR EACH ROW EXECUTE FUNCTION songs_denorm_from_genre_rename();

-- The weighted vector. Weights encode intent: a title match is a different kind
-- of hit from a phrase buried in the third verse, and ts_rank_cd is given the
-- weight array {D,C,B,A} at query time to score them accordingly.
--
--   A  title            the strongest possible signal
--   B  alt title, credits   searching an artist name should surface their work
--   C  genres           weak but useful
--   D  lyrics           the largest field, so the weakest per-hit weight
--
-- The configuration name is schema-qualified for the same reason app_norm's
-- body is: a generated-column expression is evaluated under a restricted
-- search_path, where a bare 'app_simple' does not resolve.
ALTER TABLE songs ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('public.app_simple', app_norm(coalesce(title,        ''))), 'A') ||
  setweight(to_tsvector('public.app_simple', app_norm(coalesce(alt_title,    ''))), 'B') ||
  setweight(to_tsvector('public.app_simple', app_norm(coalesce(credits_text, ''))), 'B') ||
  setweight(to_tsvector('public.app_simple', app_norm(coalesce(genres_text,  ''))), 'C') ||
  setweight(to_tsvector('public.app_simple', app_norm(coalesce(lyrics,       ''))), 'D')
) STORED;

CREATE INDEX songs_search_vector_idx ON songs USING GIN (search_vector);

-- Trigram indexes carry the fuzzy half of search: full-text matching is exact
-- per token, so a misspelled artist name would otherwise return nothing.
CREATE INDEX songs_title_trgm_idx   ON songs USING GIN (app_norm(title) gin_trgm_ops);
CREATE INDEX songs_credits_trgm_idx ON songs USING GIN (app_norm(credits_text) gin_trgm_ops);
CREATE INDEX people_name_trgm_idx   ON people USING GIN (normalized_name gin_trgm_ops);
