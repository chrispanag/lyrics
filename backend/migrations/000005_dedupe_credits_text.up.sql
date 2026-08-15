-- Deduplicate the denormalized credit names.
--
-- A person credited in more than one capacity on the same song (composer and
-- lyricist, say) appeared once per credit: "Leonard Cohen Leonard Cohen". That
-- is noise in the search vector, and it drags down the word-similarity score
-- used for fuzzy artist matching.

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

-- Rebuild every existing row so the change applies to songs already stored,
-- not only to ones edited from now on.
SELECT refresh_songs_denorm(ARRAY(SELECT id FROM songs));
