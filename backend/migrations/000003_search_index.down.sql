DROP INDEX IF EXISTS people_name_trgm_idx;
DROP INDEX IF EXISTS songs_credits_trgm_idx;
DROP INDEX IF EXISTS songs_title_trgm_idx;
DROP INDEX IF EXISTS songs_search_vector_idx;

ALTER TABLE songs DROP COLUMN IF EXISTS search_vector;

DROP TRIGGER IF EXISTS genres_rename_denorm ON genres;
DROP TRIGGER IF EXISTS people_rename_denorm ON people;
DROP TRIGGER IF EXISTS song_genres_denorm   ON song_genres;
DROP TRIGGER IF EXISTS song_credits_denorm  ON song_credits;

DROP FUNCTION IF EXISTS songs_denorm_from_genre_rename();
DROP FUNCTION IF EXISTS songs_denorm_from_person_rename();
DROP FUNCTION IF EXISTS songs_denorm_from_genres();
DROP FUNCTION IF EXISTS songs_denorm_from_credits();
DROP FUNCTION IF EXISTS refresh_songs_denorm(uuid[]);
