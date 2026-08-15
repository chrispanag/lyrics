-- User-curated song lists. Every user gets a default "Favorites" list on
-- provisioning; additional named lists are created on demand.

CREATE TABLE lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text        NOT NULL CHECK (length(btrim(name)) > 0),
  description  text,
  is_public    boolean     NOT NULL DEFAULT false,
  is_default   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Names are unique per owner, compared normalized so "Rebetika" and "ρεμπέτικα"
-- each collide with their own casing/accent variants rather than producing
-- near-duplicate lists a user cannot tell apart.
CREATE UNIQUE INDEX lists_owner_name_key ON lists (owner_id, app_norm(name));

-- At most one default list per owner.
CREATE UNIQUE INDEX lists_owner_default_key ON lists (owner_id) WHERE is_default;

CREATE INDEX lists_owner_idx  ON lists (owner_id, created_at DESC);
CREATE INDEX lists_public_idx ON lists (created_at DESC) WHERE is_public;

CREATE TRIGGER lists_set_updated_at
  BEFORE UPDATE ON lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE list_items (
  list_id   uuid        NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  song_id   uuid        NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  position  int         NOT NULL DEFAULT 0,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, song_id)
);

CREATE INDEX list_items_ordered_idx ON list_items (list_id, position, added_at);
CREATE INDEX list_items_song_idx    ON list_items (song_id);
