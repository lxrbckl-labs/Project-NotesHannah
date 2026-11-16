-- migrate: foreign_keys off
-- More file types: WebP, GIF, TIFF, AVIF, BMP, old and OpenDocument decks and text documents, Word.
-- SQLite cannot change a CHECK in place, so the table is rebuilt (the documented twelve-step way). The
-- runner turns foreign keys off for this file: dropping the old table with them on would cascade and
-- delete every page and job. It checks for violations afterwards. Also adds `conversion_notes`: the
-- converter's file-level warnings (an animated GIF kept to its first frame, macros left unrun) as JSON.
-- It sits in the 06xx range, not 02xx: 0610 added `parked_node_id` to this table, so a rebuild must
-- come after it (a database that has already run 0610 would lose the column otherwise).

CREATE TABLE source_files_new (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  -- Where it is filed. A deleted library node puts the file back in the inbox.
  node_id          TEXT REFERENCES nodes (id) ON DELETE SET NULL,
  original_name    TEXT NOT NULL,
  sha256           TEXT NOT NULL CHECK (length(sha256) = 64),
  bytes            INTEGER NOT NULL CHECK (bytes > 0),
  type             TEXT NOT NULL CHECK (type IN
                     ('pdf', 'pptx', 'ppt', 'docx', 'doc', 'odp', 'odt',
                      'jpeg', 'png', 'heic', 'webp', 'gif', 'tiff', 'avif', 'bmp')),
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
  trashed_at       INTEGER,
  parked_node_id   TEXT,
  conversion_notes TEXT                    -- JSON array of strings, or NULL
);

INSERT INTO source_files_new
  (id, user_id, node_id, original_name, sha256, bytes, type, status, error_code, error_message,
   page_count, uploaded_by, claimed_by, claimed_at, claim_expires_at, created_at, updated_at,
   trashed_at, parked_node_id)
SELECT
   id, user_id, node_id, original_name, sha256, bytes, type, status, error_code, error_message,
   page_count, uploaded_by, claimed_by, claimed_at, claim_expires_at, created_at, updated_at,
   trashed_at, parked_node_id
FROM source_files;

DROP TABLE source_files;
ALTER TABLE source_files_new RENAME TO source_files;

CREATE INDEX source_files_user ON source_files (user_id, id DESC);
CREATE INDEX source_files_status ON source_files (user_id, status, id DESC);
CREATE INDEX source_files_node ON source_files (user_id, node_id, id DESC) WHERE node_id IS NOT NULL;
CREATE INDEX source_files_sha ON source_files (user_id, sha256);
CREATE INDEX source_files_parked ON source_files (user_id, parked_node_id)
  WHERE parked_node_id IS NOT NULL;

CREATE TRIGGER source_files_unfiled AFTER UPDATE OF node_id ON source_files
WHEN new.node_id IS NULL AND old.node_id IS NOT NULL AND new.status = 'filed'
BEGIN
  UPDATE source_files SET status = 'transcribed' WHERE id = new.id;
END;
