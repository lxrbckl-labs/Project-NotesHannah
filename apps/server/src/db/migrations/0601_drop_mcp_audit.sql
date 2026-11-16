-- The per-call MCP audit table (0600) is folded into the activity log: every
-- agent change is recorded there by the domains, the same way for MCP and the
-- HTTP API, and refused MCP calls go to the server log. Nothing read it.
DROP TABLE IF EXISTS mcp_audit;
