-- Her own picture behind the pages (Settings, "Background"), in place of the dotted grid.
-- One per account, kept in the database so it follows her to every device and is in every backup.
-- The app shrinks a picture before sending it, so a row is at most a few megabytes
-- (the route refuses more than BACKGROUND_MAX_BYTES).
CREATE TABLE user_backgrounds (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes      BLOB NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
