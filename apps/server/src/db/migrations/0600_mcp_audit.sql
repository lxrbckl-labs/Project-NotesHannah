-- What agents did over MCP (H10): one row per call that changes something,
-- including refused ones (outcome is the error code). Written by the MCP layer
-- through its AuditPort. `user_id` and `key_id` have no foreign keys so the
-- log outlives a revoked or deleted key; times are ISO 8601 UTC strings.
CREATE TABLE mcp_audit (
  seq         INTEGER PRIMARY KEY,
  user_id     TEXT NOT NULL,
  key_id      TEXT NOT NULL,
  agent_label TEXT,
  tool        TEXT NOT NULL,
  action      TEXT,
  -- JSON array of the IDs the call created or changed.
  target_ids  TEXT NOT NULL DEFAULT '[]',
  outcome     TEXT NOT NULL,
  at          TEXT NOT NULL
) STRICT;

CREATE INDEX mcp_audit_by_user ON mcp_audit (user_id, seq DESC);
