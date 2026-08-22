DROP TABLE IF EXISTS user_avatars;

ALTER TABLE users DROP COLUMN IF EXISTS avatar_updated_at;
