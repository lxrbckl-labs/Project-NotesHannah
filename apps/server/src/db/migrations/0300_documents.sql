-- Documents: the body of a library node of kind "document" or "lecture".
-- `user_id` and `node_id` carry no foreign keys on purpose (the users and
-- library tables belong to other lanes; the node hooks keep them in step).
CREATE TABLE documents (
  seq            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  user_id        TEXT NOT NULL,
  node_id        TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('lecture_note', 'study_guide', 'practice_set', 'free')),
  title          TEXT NOT NULL,
  review_status  TEXT NOT NULL CHECK (review_status IN ('unverified', 'reviewed')),
  revision       INTEGER NOT NULL CHECK (revision >= 1),
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_edited_by TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  trashed_at     TEXT
);

-- One document per node.
CREATE UNIQUE INDEX documents_node ON documents (node_id);
CREATE INDEX documents_user ON documents (user_id, updated_at DESC);

-- Blocks, ordered within a document by `position` (0..n-1, rewritten on every
-- write that reorders). `data` is the full validated block JSON; the other
-- columns are extracted for querying and for the search index.
CREATE TABLE blocks (
  seq            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  document_id    TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  position       INTEGER NOT NULL,
  type           TEXT NOT NULL,
  origin         TEXT NOT NULL CHECK (origin IN ('agent', 'user')),
  review_status  TEXT NOT NULL CHECK (review_status IN ('unverified', 'reviewed')),
  last_edited_by TEXT NOT NULL,
  plain_text     TEXT NOT NULL,
  data           TEXT NOT NULL
);

CREATE INDEX blocks_order ON blocks (document_id, position);

-- Search over block text: external-content FTS5 kept in step by triggers, so
-- cascaded deletes clean it too.
CREATE VIRTUAL TABLE blocks_fts USING fts5 (
  plain_text,
  content = 'blocks',
  content_rowid = 'seq',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER blocks_fts_insert AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts (rowid, plain_text) VALUES (new.seq, new.plain_text);
END;

CREATE TRIGGER blocks_fts_delete AFTER DELETE ON blocks BEGIN
  INSERT INTO blocks_fts (blocks_fts, rowid, plain_text) VALUES ('delete', old.seq, old.plain_text);
END;

CREATE TRIGGER blocks_fts_update AFTER UPDATE OF plain_text ON blocks BEGIN
  INSERT INTO blocks_fts (blocks_fts, rowid, plain_text) VALUES ('delete', old.seq, old.plain_text);
  INSERT INTO blocks_fts (rowid, plain_text) VALUES (new.seq, new.plain_text);
END;

-- Full snapshots, one per saved change. The newest `revisionCap` are kept,
-- plus revision 1 (see the service for the policy).
CREATE TABLE document_revisions (
  seq           INTEGER PRIMARY KEY,
  id            TEXT NOT NULL UNIQUE,
  document_id   TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  number        INTEGER NOT NULL CHECK (number >= 1),
  author        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  summary       TEXT,
  restored_from INTEGER,
  block_count   INTEGER NOT NULL,
  snapshot      TEXT NOT NULL
);

CREATE UNIQUE INDEX document_revisions_number ON document_revisions (document_id, number);

-- One row per citation occurrence, for "what cites this page" (K5).
CREATE TABLE document_citations (
  seq         INTEGER PRIMARY KEY,
  user_id     TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  block_id    TEXT NOT NULL,
  field       TEXT,
  file_id     TEXT NOT NULL,
  page_id     TEXT NOT NULL,
  item_type   TEXT NOT NULL,
  quote       TEXT NOT NULL,
  region      TEXT
);

CREATE INDEX document_citations_page ON document_citations (user_id, page_id, seq);
CREATE INDEX document_citations_file ON document_citations (user_id, file_id, seq);
CREATE INDEX document_citations_doc ON document_citations (document_id);
