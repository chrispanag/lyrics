-- Profile pictures.
--
-- Prelude Auth has no picture field: a user's `profile` there is an open map of
-- string values, and nothing in the product hosts an image. So the bytes live
-- here, which is the same split already made for roles and for email
-- verification — Prelude owns credentials, this database owns everything the
-- app decides for itself.

ALTER TABLE users ADD COLUMN avatar_updated_at timestamptz;

COMMENT ON COLUMN users.avatar_updated_at IS
  'When the picture was last written, or NULL when there is none. This is the '
  'only version the client sees — it is the ETag and the cache-busting query '
  'parameter — so it must be written in the same transaction as the '
  'user_avatars row it describes.';

-- The bytes get their own table rather than a column on `users`. Every read of
-- a user shares one column list (`userColumns` in internal/store/users.go),
-- scanned by GET /me, by provisioning, and by every page of the admin console;
-- a bytea there would be dragged through all of them.
--
-- There is deliberately no `updated_at` here. A second timestamp could disagree
-- with the one above, and only the one above can appear in the `RETURNING`
-- clause every write of a user already uses — a joined column cannot.
CREATE TABLE user_avatars (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type text  NOT NULL,
  image        bytea NOT NULL CHECK (length(image) > 0)
);

COMMENT ON TABLE user_avatars IS
  'One normalized square picture per user. The API re-encodes whatever was '
  'uploaded, so content_type is always image/jpeg today; it is stored rather '
  'than assumed so a second format is a data change, not a migration.';
