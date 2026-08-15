-- Core catalog: users, the people credited on songs, genres, and songs themselves.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Users mirror Prelude Auth accounts. Prelude owns credentials and sessions; we
-- own authorization. Roles live here rather than in Prelude custom claims so a
-- promotion takes effect on the next request instead of the next token refresh.
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prelude_user_id  text        NOT NULL UNIQUE,
  email            text        NOT NULL UNIQUE,
  display_name     text,
  role             text        NOT NULL DEFAULT 'user'
                     CHECK (role IN ('user', 'contributor', 'admin')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);

COMMENT ON COLUMN users.prelude_user_id IS
  'The `user_id` claim from the Prelude access token. This, not the email, is the '
  'stable join key: an email can be changed in Prelude, this identifier cannot.';

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One table for every credited human. A person is an artist on one song and a
-- composer on another, so the role belongs on the credit, not on the person.
CREATE TABLE people (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  normalized_name  text        GENERATED ALWAYS AS (app_norm(name)) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Deduplicates "Μίκης Θεοδωράκης" against "μικης θεοδωρακης" on insert. The
-- tradeoff is that two genuinely distinct artists sharing a name collide; that
-- is the right default for a catalog this size.
CREATE UNIQUE INDEX people_normalized_name_key ON people (normalized_name);

CREATE TRIGGER people_set_updated_at
  BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE genres (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  slug        text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER genres_set_updated_at
  BEFORE UPDATE ON genres
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE songs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text        NOT NULL CHECK (length(btrim(title)) > 0),
  alt_title         text,
  lyrics            text        NOT NULL DEFAULT '',
  language          text        NOT NULL DEFAULT 'el'
                      CHECK (language ~ '^[a-z]{2}$'),
  youtube_url       text,
  youtube_video_id  text,
  release_year      int         CHECK (release_year BETWEEN 1000 AND 2200),
  notes             text,

  -- Denormalized copies of the credited names and genre names, maintained by
  -- trigger in the next migration. They exist because a generated column may
  -- only reference its own row: without them, artist names could not
  -- participate in the weighted search vector at all.
  credits_text      text        NOT NULL DEFAULT '',
  genres_text       text        NOT NULL DEFAULT '',

  created_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
  updated_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER songs_set_updated_at
  BEFORE UPDATE ON songs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX songs_created_at_idx ON songs (created_at DESC);
CREATE INDEX songs_language_idx   ON songs (language);
CREATE INDEX songs_created_by_idx ON songs (created_by);
-- Backs the default alphabetical browse, which must order the way humans read
-- rather than by byte value ("Ά" must sort next to "Α", not after "Ω").
CREATE INDEX songs_title_sort_idx ON songs (app_norm(title));

CREATE TABLE song_credits (
  song_id    uuid NOT NULL REFERENCES songs (id)  ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
  role       text NOT NULL CHECK (role IN ('artist', 'composer', 'lyricist', 'performer')),
  position   int  NOT NULL DEFAULT 0,
  PRIMARY KEY (song_id, person_id, role)
);

CREATE INDEX song_credits_person_idx    ON song_credits (person_id, role);
CREATE INDEX song_credits_role_idx      ON song_credits (role);
CREATE INDEX song_credits_song_pos_idx  ON song_credits (song_id, role, position);

CREATE TABLE song_genres (
  song_id   uuid NOT NULL REFERENCES songs (id)  ON DELETE CASCADE,
  genre_id  uuid NOT NULL REFERENCES genres (id) ON DELETE CASCADE,
  PRIMARY KEY (song_id, genre_id)
);

CREATE INDEX song_genres_genre_idx ON song_genres (genre_id);
