-- Search primitives: the normalization function and text search configuration
-- that every searchable column in this schema depends on.
--
-- The corpus is multilingual (primarily Greek and English), which rules out a
-- stemmed configuration: running a Greek line through the English Snowball
-- stemmer produces garbage, and vice versa. Instead we index unstemmed and
-- compensate with prefix matching at query time plus trigram similarity for
-- typo tolerance.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- app_norm is the single normalization path shared by the stored search vector,
-- the parsed query, and every trigram index. Both sides of a comparison must go
-- through the identical function or accented queries silently match nothing.
--
-- app_norm must produce *exactly* what the app_simple configuration below
-- produces from raw text — no more, no less. That equivalence is the whole
-- contract, and it is easy to break:
--
-- An earlier version of this function also folded Greek final sigma
-- (`translate(..., 'ς', 'σ')`), reasoning that Greek writes the same letter
-- differently at the end of a word. Matching still worked, because both the
-- stored vector and the query went through app_norm. But `ts_headline` reads
-- the RAW lyrics through app_simple, which has no sigma folding — so query
-- tokens and headline tokens diverged, and every snippet for a Greek word
-- ending in ς silently lost its highlighting. Greek inflection is handled by
-- prefix matching at query time instead, which costs nothing here.
--
-- Two further details are load-bearing:
--
-- 1. Naming the dictionary explicitly is what makes this IMMUTABLE. The
--    one-argument `unaccent(text)` is only STABLE because it resolves the
--    default dictionary at runtime, and STABLE functions cannot back generated
--    columns or expression indexes.
-- 2. Everything is schema-qualified and the `::regdictionary` cast is
--    explicit. PostgreSQL evaluates index and generated-column expressions
--    under a restricted `search_path` (pg_catalog only). An unqualified
--    `unaccent(...)` resolves fine in an ordinary query and then fails with
--    "function unaccent(regdictionary, text) does not exist" the moment it is
--    inlined into a CREATE INDEX — so this reads as redundant but is not.
CREATE OR REPLACE FUNCTION app_norm(txt text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, txt));
$$;

COMMENT ON FUNCTION app_norm(text) IS
  'Lowercase + strip diacritics. Must stay equivalent to what the app_simple text '
  'search configuration does to raw text, or ts_headline highlighting breaks. '
  'Declared IMMUTABLE so it can back generated columns and expression indexes; if the '
  'unaccent dictionary is ever modified, every index built on it must be REINDEXed.';

-- app_simple unaccents at the dictionary level. This matters for ts_headline,
-- which operates on the RAW lyrics rather than the normalized copy: under the
-- stock `simple` config it would compare accented source text against
-- unaccented query tokens, match nothing, and silently degrade every Greek
-- snippet into "the first N words of the song".
-- `CREATE TEXT SEARCH CONFIGURATION` has no IF NOT EXISTS form, and `migrate
-- drop` only removes tables — so a reset leaves this object behind and the
-- rerun would fail on a duplicate name.
DROP TEXT SEARCH CONFIGURATION IF EXISTS app_simple;
CREATE TEXT SEARCH CONFIGURATION app_simple (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION app_simple
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;

COMMENT ON TEXT SEARCH CONFIGURATION app_simple IS
  'Unstemmed, diacritic-insensitive configuration used for the song search vector, '
  'the parsed tsquery, and ts_headline snippet generation.';
