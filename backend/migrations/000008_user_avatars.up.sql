-- Profile pictures.
--
-- Prelude Auth has no picture field, so the bytes live here.

ALTER TABLE users ADD COLUMN avatar_updated_at timestamptz;

COMMENT ON COLUMN users.avatar_updated_at IS
  'When the picture was last written, or NULL when there is none. This is the '
  'only version the client sees — it is the ETag and the cache-busting query '
  'parameter — so it must be written in the same transaction as the '
  'user_avatars row it describes.';

-- A separate table so the bytea stays out of `userColumns`, which every user
-- read scans. No `updated_at`: users.avatar_updated_at is the one version.
CREATE TABLE user_avatars (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type text  NOT NULL,
  image        bytea NOT NULL CHECK (length(image) > 0)
);

COMMENT ON TABLE user_avatars IS
  'One normalized square picture per user. The API re-encodes whatever was '
  'uploaded, so content_type is always image/jpeg today; it is stored rather '
  'than assumed so a second format is a data change, not a migration.';
