-- Side notes ("margin notes" in code): her private remarks beside one block of a document, like
-- comments in a shared document but notes to herself. Stored apart from the blocks, so writing
-- one never edits the document, its review state or its revision history.
-- A note points at its block by id only (no foreign key): when the block is deleted or replaced
-- the note stays, marked detached (detached_at), with the block's last known text in snippet.
-- The document going for good takes its notes with it (cascade); the trash only hides them.
CREATE TABLE margin_notes (
  seq          INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL,
  document_id  TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  block_id     TEXT NOT NULL,
  quote        TEXT,
  text         TEXT NOT NULL,
  colour       TEXT,
  resolved_at  TEXT,
  detached_at  TEXT,
  snippet      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
-- A document's notes in the order she wrote them (also what every block write reads).
CREATE INDEX margin_notes_document ON margin_notes (user_id, document_id, seq);
-- "Her open notes, newest first" for agents, and her search, scan one person's rows.
CREATE INDEX margin_notes_user ON margin_notes (user_id, resolved_at, seq);
