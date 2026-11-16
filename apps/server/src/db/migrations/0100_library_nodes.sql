-- The library tree: term > course > section > folder* > lecture | document.
-- One row per node. `seq` is the integer row id the search index points at;
-- `id` is the permanent public ID. `user_id` is indexed but deliberately has
-- no foreign key (the users table belongs to another lane).
CREATE TABLE nodes (
  seq            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  user_id        TEXT NOT NULL,
  parent_id      TEXT REFERENCES nodes (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('term', 'course', 'section', 'folder', 'lecture', 'document')),
  name           TEXT NOT NULL,
  section        TEXT CHECK (section IN ('sources', 'lectures', 'study_guides', 'practice', 'exams')),
  course_code    TEXT,
  lecture_number INTEGER,
  lecture_date   TEXT,
  sort_key       TEXT NOT NULL,
  favourite      INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  trashed_at     TEXT,
  opened_at      TEXT
);

-- Siblings never share an order key (the root's parent_id is NULL, so fold it).
CREATE UNIQUE INDEX nodes_sibling_order ON nodes (user_id, COALESCE(parent_id, ''), sort_key);
-- Children of a node, in order.
CREATE INDEX nodes_children ON nodes (user_id, parent_id, sort_key);
-- Walking down and the cascade on delete.
CREATE INDEX nodes_parent ON nodes (parent_id);
-- Trash, newest first.
CREATE INDEX nodes_trash ON nodes (user_id, trashed_at DESC, id) WHERE trashed_at IS NOT NULL;
-- Favourites.
CREATE INDEX nodes_favourites ON nodes (user_id, updated_at DESC) WHERE favourite = 1 AND trashed_at IS NULL;
-- Recently opened.
CREATE INDEX nodes_recents ON nodes (user_id, opened_at DESC) WHERE opened_at IS NOT NULL;

-- Name search: an external-content FTS5 index kept in step by triggers.
CREATE VIRTUAL TABLE nodes_fts USING fts5 (
  name,
  content = 'nodes',
  content_rowid = 'seq',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts (rowid, name) VALUES (new.seq, new.name);
END;

CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts (nodes_fts, rowid, name) VALUES ('delete', old.seq, old.name);
END;

CREATE TRIGGER nodes_fts_update AFTER UPDATE OF name ON nodes BEGIN
  INSERT INTO nodes_fts (nodes_fts, rowid, name) VALUES ('delete', old.seq, old.name);
  INSERT INTO nodes_fts (rowid, name) VALUES (new.seq, new.name);
END;
