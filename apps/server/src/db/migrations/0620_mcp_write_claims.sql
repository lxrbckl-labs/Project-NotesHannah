-- Advisory "I am writing material for this" claims taken by agents over MCP, so two
-- agents do not write a study guide for the same lecture at once. One live claim per
-- library node; a claim expires on its own (expires_at, ms since the epoch), so a
-- crashed agent never blocks anyone for long. Owned by the MCP layer.
CREATE TABLE mcp_write_claims (
  user_id    TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  key_id     TEXT NOT NULL,
  label      TEXT,
  note       TEXT,
  claimed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, node_id)
) STRICT;
