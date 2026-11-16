-- The request queue: what she leaves for the next agent session.
-- `user_id` and the target columns carry no foreign keys on purpose: the
-- library, documents and files tables belong to other lanes, and the node and
-- file hooks keep requests in step when their targets are trashed or deleted.
CREATE TABLE requests (
  seq              INTEGER PRIMARY KEY,
  id               TEXT NOT NULL UNIQUE,
  user_id          TEXT NOT NULL,
  target_type      TEXT NOT NULL CHECK (target_type IN ('library', 'node', 'document', 'block', 'source', 'question')),
  node_id          TEXT,
  document_id      TEXT,
  block_id         TEXT,
  file_id          TEXT,
  page_id          TEXT,
  question_id      TEXT,
  -- The library node the target lives under, found when the request is made.
  -- The node hooks (trash, restore, delete) work through this column.
  scope_node_id    TEXT,
  kind             TEXT NOT NULL,
  message          TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('waiting', 'in_progress', 'done', 'declined', 'cancelled')),
  claimed_by       TEXT,                  -- Actor, as JSON
  claimed_at       INTEGER,
  claim_expires_at INTEGER,
  reply            TEXT,                  -- RequestReply, as JSON
  reopens          TEXT NOT NULL DEFAULT '[]',
  -- Set while the target is in the trash: the request is hidden, not lost.
  hidden_at        INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  closed_at        INTEGER
);

CREATE INDEX requests_user_status ON requests (user_id, status, seq);
CREATE INDEX requests_user_document ON requests (user_id, document_id) WHERE document_id IS NOT NULL;
CREATE INDEX requests_user_scope ON requests (user_id, scope_node_id) WHERE scope_node_id IS NOT NULL;
CREATE INDEX requests_user_file ON requests (user_id, file_id) WHERE file_id IS NOT NULL;
CREATE INDEX requests_user_question ON requests (user_id, question_id) WHERE question_id IS NOT NULL;
-- Claims that may have run out.
CREATE INDEX requests_claims ON requests (claim_expires_at) WHERE status = 'in_progress';
