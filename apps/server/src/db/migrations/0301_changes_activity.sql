-- The change feed ("what changed since"). One global AUTOINCREMENT sequence:
-- strictly increasing, so for any one user it is monotonic (with gaps where
-- other users wrote). SQLite serialises writers, so sequence order is commit order.
CREATE TABLE changes (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  at          TEXT NOT NULL,
  action      TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_ids  TEXT NOT NULL,
  document_id TEXT,
  node_id     TEXT,
  revision    INTEGER,
  actor       TEXT NOT NULL,
  request_id  TEXT,
  summary     TEXT NOT NULL
);

CREATE INDEX changes_user ON changes (user_id, seq);

-- The agent activity log: one row per thing an agent did.
CREATE TABLE activity (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL,
  at        TEXT NOT NULL,
  key_id    TEXT NOT NULL,
  key_label TEXT,
  action    TEXT NOT NULL,
  summary   TEXT NOT NULL,
  links     TEXT NOT NULL
);

CREATE INDEX activity_user ON activity (user_id, seq DESC);
CREATE INDEX activity_key ON activity (user_id, key_id, seq DESC);

-- Which objects an activity row touched, so the log can be filtered by object.
CREATE TABLE activity_objects (
  activity_seq INTEGER NOT NULL REFERENCES activity (seq) ON DELETE CASCADE,
  object_id    TEXT NOT NULL,
  PRIMARY KEY (activity_seq, object_id)
);

CREATE INDEX activity_objects_object ON activity_objects (object_id, activity_seq);
