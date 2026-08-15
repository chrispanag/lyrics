-- Export the old lyrics catalog to the NDJSON interchange format that
-- `import-songs` consumes. One JSON object per line, one line per song.
--
-- Run against the OLD database, capturing stdout:
--
--   psql "$OLD_DATABASE_URL" -At -f scripts/export-old-db.sql > songs.ndjson
--
-- The -A (unaligned) and -t (tuples only) flags are what keep the output valid
-- NDJSON: without them psql adds column headers, padding and a row count.
-- Newlines inside lyrics are escaped by to_json as \n, so a song stays on one
-- line no matter how long it is.
--
-- The old schema (TypeORM, PostgreSQL 14):
--
--   song            id, title, "altTitle", lyrics, year (varchar), "createdById"
--   person          id, "firstName", "lastName"
--   song_to_person  "songId", "personId", role ('composer' | 'songwriter')
--
-- Three mappings are applied here; everything else is left for the loader to
-- normalize, so the rules live in one tested place rather than split across
-- both halves of the pipeline.
--
--   1. person."firstName" + "lastName" -> a single people.name, the shape the
--      new schema stores. The old split cannot round-trip a mononym anyway.
--   2. song.year is a varchar. Only a bare four-digit value converts; anything
--      else becomes null rather than failing the export. (Every populated row
--      in the source is four digits, so this only guards future edits.)
--   3. The source role enum is passed through verbatim. 'songwriter' means the
--      person who wrote the words, which the loader maps onto 'lyricist'.
--
-- Deliberately NOT exported, because the new schema has no equivalent or no
-- safe one:
--
--   * song."createdById" / the user table — the new catalog delegates identity
--     to Prelude Auth, so a local password hash has nowhere to go. Imported
--     songs get their attribution from the loader's -actor-email flag.
--   * song_to_user — per-user favorites. The new schema models these as lists
--     owned by a users row, which only exists after that person signs in
--     through Prelude.
--   * genres — the old schema has no genre concept at all.

SELECT json_build_object(
         'source_id',    s.id::text,
         'title',        btrim(s.title),
         'alt_title',    nullif(btrim(coalesce(s."altTitle", '')), ''),
         'lyrics',       s.lyrics,
         -- The source has no language column and the catalog is Greek.
         'language',     'el',
         'release_year', CASE WHEN s.year ~ '^[0-9]{4}$' THEN s.year::int END,
         'credits',      (
           SELECT coalesce(json_agg(
                    json_build_object(
                      'name', btrim(p."firstName" || ' ' || p."lastName"),
                      'role', sp.role
                    )
                    -- Composers before lyricists, then by the join table's own
                    -- key, so the credit order the old app displayed survives.
                    ORDER BY sp.role, sp."songToPersonId"
                  ), '[]'::json)
           FROM song_to_person sp
           JOIN person p ON p.id = sp."personId"
           WHERE sp."songId" = s.id
         )
       )
FROM song s
ORDER BY s.id;
