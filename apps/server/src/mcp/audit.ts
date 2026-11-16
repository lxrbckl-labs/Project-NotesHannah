import type { Db } from "../db/client.js";
import type { AuditEntry, AuditPort } from "./ports.js";

/** The default audit log: the `mcp_audit` table (migration 0600). */
export function sqliteAudit(db: Db): AuditPort & {
  list(userId: string, limit?: number): AuditEntry[];
} {
  const insert = db.prepare(
    `INSERT INTO mcp_audit (user_id, key_id, agent_label, tool, action, target_ids, outcome, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const select = db.prepare(
    `SELECT user_id, key_id, agent_label, tool, action, target_ids, outcome, at
     FROM mcp_audit WHERE user_id = ? ORDER BY seq DESC LIMIT ?`,
  );
  return {
    record(e) {
      insert.run(
        e.userId,
        e.keyId,
        e.agentLabel,
        e.tool,
        e.action,
        JSON.stringify(e.targetIds),
        e.outcome,
        e.at,
      );
    },
    list(userId, limit = 50) {
      const rows = select.all(userId, limit) as Array<{
        user_id: string;
        key_id: string;
        agent_label: string | null;
        tool: string;
        action: string | null;
        target_ids: string;
        outcome: string;
        at: string;
      }>;
      return rows.map((r) => ({
        userId: r.user_id,
        keyId: r.key_id,
        agentLabel: r.agent_label,
        tool: r.tool,
        action: r.action,
        targetIds: JSON.parse(r.target_ids) as string[],
        outcome: r.outcome,
        at: r.at,
      }));
    },
  };
}
