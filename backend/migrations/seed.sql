-- Development seed data.
--
-- Run with `make seed`. Deliberately NOT a migration: it is sample content,
-- not schema, and must never run against a real catalog.
--
-- The mix is intentional — Greek and English songs, accented and unaccented
-- spellings, shared contributors across songs — so that search ranking,
-- diacritic folding, and credit filters all have something to demonstrate the
-- moment the app starts.

BEGIN;

INSERT INTO genres (name, slug) VALUES
  ('Έντεχνο',   'entechno'),
  ('Ρεμπέτικο', 'rempetiko'),
  ('Λαϊκό',     'laiko'),
  ('Rock',      'rock'),
  ('Folk',      'folk')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO people (name) VALUES
  ('Μίκης Θεοδωράκης'),
  ('Μάνος Χατζιδάκις'),
  ('Νίκος Γκάτσος'),
  ('Γιώργος Νταλάρας'),
  ('Χάρις Αλεξίου'),
  ('Βασίλης Τσιτσάνης'),
  ('Μάρκος Βαμβακάρης'),
  ('Διονύσης Σαββόπουλος'),
  ('Nick Cave'),
  ('Leonard Cohen'),
  ('Nina Simone')
ON CONFLICT (normalized_name) DO NOTHING;

-- Songs are inserted with their credits and genres resolved by name, so this
-- script stays readable and does not hard-code any identifiers.
WITH new_songs AS (
  INSERT INTO songs (title, alt_title, lyrics, language, youtube_url, youtube_video_id, release_year, notes)
  VALUES
    (
      'Το Τραγούδι της Αγάπης',
      'To Tragoudi tis Agapis',
      E'Μια μέρα στη θάλασσα\nθα σε ξαναδώ\nκαι θα σου πω τα λόγια\nπου δεν είπα εδώ\n\nΗ αγάπη μου μεγάλη\nσαν τον ουρανό\nκαι το τραγούδι τούτο\nγια σένα το κρατώ',
      'el', NULL, NULL, 1964,
      'A seed entry used to demonstrate search ranking.'
    ),
    (
      'Θάλασσα Πλατιά',
      NULL,
      E'Στης θάλασσας τα βάθη\nη αγάπη μου κοιμάται\nκι ο άνεμος τη σκεπάζει\nμε αφρό και με φεγγάρι\n\nΘάλασσα πλατιά\nπάρε με μακριά',
      'el', NULL, NULL, 1971, NULL
    ),
    (
      'Συννεφιασμένη Κυριακή',
      'Synnefiasmeni Kyriaki',
      E'Συννεφιασμένη Κυριακή\nμοιάζεις με την καρδιά μου\nπου έχει πάντα συννεφιά\nΧριστέ και Παναγιά μου',
      'el', NULL, NULL, 1948,
      'One of the best known rebetiko songs.'
    ),
    (
      'Χάρτινο το Φεγγαράκι',
      'Hartino to Fengaraki',
      E'Θα φύγω και θα γυρίσω\nκαι θα σε βρω\nχάρτινο το φεγγαράκι\nψεύτικος ο ντουνιάς',
      'el', NULL, NULL, 1957, NULL
    ),
    (
      'Into My Arms',
      NULL,
      E'I do not believe in an interventionist God\nBut I know, darling, that you do\nBut if I did I would kneel down and ask Him\nNot to intervene when it came to you\n\nInto my arms, O Lord\nInto my arms',
      'en', 'https://www.youtube.com/watch?v=y8ptCQvGQGE', 'y8ptCQvGQGE', 1997, NULL
    ),
    (
      'Hallelujah',
      NULL,
      E'Now I''ve heard there was a secret chord\nThat David played and it pleased the Lord\nBut you don''t really care for music, do you?\n\nHallelujah, Hallelujah',
      'en', NULL, NULL, 1984, NULL
    ),
    (
      'Feeling Good',
      NULL,
      E'Birds flying high, you know how I feel\nSun in the sky, you know how I feel\nBreeze drifting on by, you know how I feel\n\nIt''s a new dawn, it''s a new day\nIt''s a new life for me',
      'en', NULL, NULL, 1965, NULL
    )
  RETURNING id, title
)
INSERT INTO song_credits (song_id, person_id, role, position)
SELECT s.id, p.id, c.role, c.position
FROM new_songs s
JOIN (VALUES
  ('Το Τραγούδι της Αγάπης', 'Μίκης Θεοδωράκης',     'composer',  0),
  ('Το Τραγούδι της Αγάπης', 'Νίκος Γκάτσος',        'lyricist',  0),
  ('Το Τραγούδι της Αγάπης', 'Γιώργος Νταλάρας',     'artist',    0),
  ('Θάλασσα Πλατιά',         'Μίκης Θεοδωράκης',     'composer',  0),
  ('Θάλασσα Πλατιά',         'Χάρις Αλεξίου',        'artist',    0),
  ('Συννεφιασμένη Κυριακή',  'Βασίλης Τσιτσάνης',    'composer',  0),
  ('Συννεφιασμένη Κυριακή',  'Βασίλης Τσιτσάνης',    'lyricist',  0),
  ('Συννεφιασμένη Κυριακή',  'Γιώργος Νταλάρας',     'artist',    0),
  ('Χάρτινο το Φεγγαράκι',   'Μάνος Χατζιδάκις',     'composer',  0),
  ('Χάρτινο το Φεγγαράκι',   'Νίκος Γκάτσος',        'lyricist',  0),
  ('Into My Arms',           'Nick Cave',            'artist',    0),
  ('Into My Arms',           'Nick Cave',            'composer',  0),
  ('Hallelujah',             'Leonard Cohen',        'artist',    0),
  ('Hallelujah',             'Leonard Cohen',        'lyricist',  0),
  ('Feeling Good',           'Nina Simone',          'artist',    0)
) AS c(song_title, person_name, role, position) ON c.song_title = s.title
JOIN people p ON p.normalized_name = app_norm(c.person_name)
ON CONFLICT DO NOTHING;

INSERT INTO song_genres (song_id, genre_id)
SELECT s.id, g.id
FROM songs s
JOIN (VALUES
  ('Το Τραγούδι της Αγάπης', 'entechno'),
  ('Θάλασσα Πλατιά',         'entechno'),
  ('Συννεφιασμένη Κυριακή',  'rempetiko'),
  ('Συννεφιασμένη Κυριακή',  'laiko'),
  ('Χάρτινο το Φεγγαράκι',   'entechno'),
  ('Into My Arms',           'rock'),
  ('Hallelujah',             'folk'),
  ('Feeling Good',           'folk')
) AS sg(song_title, genre_slug) ON sg.song_title = s.title
JOIN genres g ON g.slug = sg.genre_slug
ON CONFLICT DO NOTHING;

COMMIT;

\echo 'Seeded. Try:'
\echo '  curl "localhost:8080/api/v1/songs?q=θάλασσα"     — accented query'
\echo '  curl "localhost:8080/api/v1/songs?q=θαλασσα"     — unaccented, same results'
\echo '  curl "localhost:8080/api/v1/songs?q=Θεοδορακης"  — misspelled artist, still matches'
