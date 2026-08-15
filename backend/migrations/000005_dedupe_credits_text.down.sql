-- Restore the ordered, non-deduplicated aggregation.
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

SELECT refresh_songs_denorm(ARRAY(SELECT id FROM songs));
