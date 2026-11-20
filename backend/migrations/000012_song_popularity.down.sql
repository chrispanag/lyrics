DROP TRIGGER IF EXISTS list_items_popularity ON list_items;

DROP FUNCTION IF EXISTS song_popularity_from_list_item();
DROP FUNCTION IF EXISTS record_song_click(uuid, text, boolean);
DROP FUNCTION IF EXISTS song_popularity_score(integer, integer, integer, integer);

DROP TABLE IF EXISTS song_clicks;
DROP TABLE IF EXISTS song_popularity;
