-- Search primitives: the normalization function and text search configuration
-- that every searchable column in this schema depends on.
--
-- Unstemmed: the corpus mixes Greek and English, and each stemmer mangles the
-- other. Recall comes from prefix matching plus trigram similarity.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- app_norm is the one normalization path for the search vector, the parsed
-- query and every trigram index.
--
-- It must produce exactly what app_simple below does to raw text: ts_headline
-- reads raw lyrics through app_simple, so any extra folding here (e.g. final
-- sigma) silently breaks snippet highlighting. See CLAUDE.md, "Search".
--
-- Naming the dictionary makes this IMMUTABLE (one-argument unaccent is only
-- STABLE). Schema-qualified because index expressions run under a restricted
-- search_path, where an unqualified call fails at CREATE INDEX.
CREATE OR REPLACE FUNCTION app_norm(txt text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, txt));
$$;

COMMENT ON FUNCTION app_norm(text) IS
  'Lowercase + strip diacritics. Must stay equivalent to what the app_simple text '
  'search configuration does to raw text, or ts_headline highlighting breaks. '
  'Declared IMMUTABLE so it can back generated columns and expression indexes; if the '
  'unaccent dictionary is ever modified, every index built on it must be REINDEXed.';

-- app_simple unaccents at the dictionary level, because ts_headline reads the
-- raw lyrics: under stock `simple`, accented text would match no query token.
-- DROP first: there is no IF NOT EXISTS form, and `migrate drop` leaves it.
DROP TEXT SEARCH CONFIGURATION IF EXISTS app_simple;
CREATE TEXT SEARCH CONFIGURATION app_simple (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION app_simple
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

COMMENT ON TEXT SEARCH CONFIGURATION app_simple IS
  'Unstemmed, diacritic-insensitive configuration used for the song search vector, '
  'the parsed tsquery, and ts_headline snippet generation.';
