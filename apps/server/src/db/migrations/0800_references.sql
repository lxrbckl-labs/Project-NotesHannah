-- References: outside pages she saves (a title, a web address, her note), tied to places in her
-- library. Only the address and her own words are stored here.
-- A tie to a node outlives the node going to the trash (it comes back with it); the node hooks
-- delete the tie when the node is deleted for good. The reference itself always stays.
CREATE TABLE "references" (
  seq         INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  kind        TEXT,
  favourite   INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX references_user ON "references" (user_id, favourite, seq);

CREATE TABLE reference_nodes (
  reference_id TEXT NOT NULL REFERENCES "references" (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  position     INTEGER NOT NULL,
  PRIMARY KEY (reference_id, node_id)
);
CREATE INDEX reference_nodes_node ON reference_nodes (user_id, node_id);
