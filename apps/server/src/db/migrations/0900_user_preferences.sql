-- Per-person preferences: one row per user holding one JSON document (docs/api.md, "Preferences").
-- The document is validated by the schema package before it is written and read tolerantly
-- (resolveTabOrder), so a later preference is a new field in it, not a new table.
CREATE TABLE user_preferences (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc        TEXT NOT NULL CHECK (json_valid(doc)),
  updated_at INTEGER NOT NULL
) STRICT;
