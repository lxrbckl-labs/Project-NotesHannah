-- Files, pages, transcripts, upload tickets and conversion jobs.
-- `user_id` columns carry no foreign key (same convention as the library);
-- every query is scoped by them. Timestamps are milliseconds since the epoch.

CREATE TABLE source_files (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  -- Where it is filed. A deleted library node puts the file back in the inbox.
  node_id          TEXT REFERENCES nodes (id) ON DELETE SET NULL,
  original_name    TEXT NOT NULL,
  sha256           TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes            INTEGER NOT NULL CHECK (bytes > 0),
  type             TEXT NOT NULL CHECK (type IN ('pdf', 'pptx', 'jpeg', 'png', 'heic')),
  status           TEXT NOT NULL CHECK (status IN
                     ('uploaded', 'converting', 'converted', 'transcribed', 'filed', 'failed')),
  error_code       TEXT,
  error_message    TEXT,
  page_count       INTEGER,
  uploaded_by      TEXT NOT NULL,          -- Actor, as JSON
  claimed_by       TEXT,                   -- Actor, as JSON
  claimed_at       INTEGER,
  claim_expires_at INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  trashed_at       INTEGER
);
CREATE INDEX source_files_user ON source_files (user_id, id DESC);
CREATE INDEX source_files_status ON source_files (user_id, status, id DESC);
CREATE INDEX source_files_node ON source_files (user_id, node_id, id DESC) WHERE node_id IS NOT NULL;
-- Reference counting for the shared original.
CREATE INDEX source_files_sha ON source_files (user_id, sha256);

-- Losing its node moves a filed file back to "transcribed" (it is no longer filed).
CREATE TRIGGER source_files_unfiled AFTER UPDATE OF node_id ON source_files
WHEN new.node_id IS NULL AND old.node_id IS NOT NULL AND new.status = 'filed'
BEGIN
  UPDATE source_files SET status = 'transcribed' WHERE id = new.id;
END;

CREATE TABLE pages (
  seq            INTEGER PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,
  file_id        TEXT NOT NULL REFERENCES source_files (id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  idx            INTEGER NOT NULL CHECK (idx >= 1),
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  image_bytes    INTEGER NOT NULL,
  has_text_layer INTEGER NOT NULL CHECK (has_text_layer IN (0, 1)),
  native_text    TEXT,
  speaker_notes  TEXT,
  transcript_id  TEXT,
  UNIQUE (file_id, idx)
);
CREATE INDEX pages_user ON pages (user_id, id);

-- Every save is a new row; `pages.transcript_id` points at the current one.
CREATE TABLE transcripts (
  id            TEXT PRIMARY KEY,
  page_id       TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  revision      INTEGER NOT NULL CHECK (revision >= 1),
  text          TEXT NOT NULL,
  flags         TEXT NOT NULL,             -- TranscriptFlag[], as JSON
  author        TEXT NOT NULL,             -- Actor, as JSON
  review_status TEXT NOT NULL DEFAULT 'unverified' CHECK (review_status IN ('unverified', 'reviewed')),
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (page_id, revision)
);

-- Text search over the current transcript of each page; rowid is pages.seq.
CREATE VIRTUAL TABLE transcripts_fts USING fts5 (
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER pages_fts_delete AFTER DELETE ON pages BEGIN
  DELETE FROM transcripts_fts WHERE rowid = old.seq;
END;

-- Agent upload links. Only a hash of the token is stored; it is single use.
CREATE TABLE upload_tickets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  BLOB NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  max_bytes   INTEGER NOT NULL,
  node_id     TEXT,
  created_by  TEXT NOT NULL,               -- Actor, as JSON
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  file_id     TEXT
);

CREATE TABLE conversion_jobs (
  id           TEXT PRIMARY KEY,
  file_id      TEXT NOT NULL REFERENCES source_files (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'done', 'failed', 'timed_out')),
  attempt      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER,
  error        TEXT
);
CREATE INDEX conversion_jobs_file ON conversion_jobs (file_id, created_at DESC);
CREATE INDEX conversion_jobs_active ON conversion_jobs (state) WHERE state IN ('pending', 'processing');
