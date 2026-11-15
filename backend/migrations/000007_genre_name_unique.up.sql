-- Genre names are unique. The slug index does not cover it: `UpdateGenre` keeps
-- the slug through a rename, so a rename could duplicate another genre's name.
-- Folding is left to the slug. See CLAUDE.md, "Genres".
CREATE UNIQUE INDEX genres_name_key ON genres (name);
