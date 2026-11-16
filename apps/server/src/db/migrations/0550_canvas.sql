-- The canvas: the second view of a document (docs/canvas.md). One row per document.
-- `data` holds cards, connectors, frames, syncedBlockIds and allowSelfLinks as JSON, validated with
-- the shared `Canvas` schema on every write. A canvas is small, always read whole and changed by
-- ops, so one row keeps every change atomic and the revision cheap. The row goes with its
-- document (ON DELETE CASCADE); a trashed document hides it through the join, not a flag.
CREATE TABLE canvases (
  document_id TEXT PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  revision    INTEGER NOT NULL CHECK (revision >= 1),
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX canvases_user ON canvases (user_id);

-- Where the app last laid the unpinned cards out, per layout variant ("wide" or "tall"), so a
-- reopened canvas looks the same. Never read as structure: pins live on the cards, this is a cache.
CREATE TABLE canvas_layout_cache (
  document_id TEXT NOT NULL REFERENCES canvases (document_id) ON DELETE CASCADE,
  variant     TEXT NOT NULL CHECK (variant IN ('wide', 'tall')),
  positions   TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (document_id, variant)
);
