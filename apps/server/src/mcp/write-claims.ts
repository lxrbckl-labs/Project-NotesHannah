import type { Db } from "../db/client.js";
import type { LibraryService } from "../domains/library/index.js";
import { AppError } from "../http/errors.js";

/** How long a writing claim lasts unless renewed (claim again, or write under it). */
export const WRITE_CLAIM_TTL_MS = 30 * 60 * 1000;

export interface WriteClaim {
  nodeId: string;
  keyId: string;
  label: string | null;
  note: string | null;
  claimedAt: string;
  expiresAt: string;
}

interface Row {
  node_id: string;
  key_id: string;
  label: string | null;
  note: string | null;
  claimed_at: number;
  expires_at: number;
}

const toClaim = (r: Row): WriteClaim => ({
  nodeId: r.node_id,
  keyId: r.key_id,
  label: r.label,
  note: r.note,
  claimedAt: new Date(r.claimed_at).toISOString(),
  expiresAt: new Date(r.expires_at).toISOString(),
});

/** Who is writing: an agent's label, else its key. */
export function holderName(c: WriteClaim): string {
  return c.label ? `${c.label} (key ${c.keyId})` : `the agent with key ${c.keyId}`;
}

/**
 * Advisory claims on library nodes for writing (a lecture, a folder, a
 * document). A claim covers the node and everything below it. Writes by
 * another key into a claimed subtree are refused with who holds it and until
 * when; the holder's own writes renew it. Her browser session is never
 * blocked: claims are between agents.
 */
export function createWriteClaims(db: Db, library: LibraryService, now: () => number) {
  const get = db.prepare(
    "SELECT * FROM mcp_write_claims WHERE user_id = ? AND node_id = ? AND expires_at > ?",
  );

  function live(userId: string, nodeId: string): WriteClaim | null {
    const row = get.get(userId, nodeId, now()) as Row | undefined;
    return row ? toClaim(row) : null;
  }

  /** The live claim on this node or the nearest claimed ancestor. */
  function covering(userId: string, nodeId: string): WriteClaim | null {
    let node: ReturnType<LibraryService["get"]>;
    try {
      node = library.get(userId, nodeId);
    } catch {
      return null; // not in her library (any more): nothing can be claimed there
    }
    for (const id of [node.id, ...[...node.ancestors].reverse()]) {
      const c = live(userId, id);
      if (c) return c;
    }
    return null;
  }

  /** Live claims on nodes strictly below this one (a study guide being written in a section, say). */
  function under(userId: string, nodeId: string): WriteClaim[] {
    const rows = db
      .prepare(
        "SELECT * FROM mcp_write_claims WHERE user_id = ? AND expires_at > ? AND node_id != ?",
      )
      .all(userId, now(), nodeId) as Row[];
    return rows.map(toClaim).filter((c) => {
      try {
        return library.get(userId, c.nodeId).ancestors.includes(nodeId);
      } catch {
        return false;
      }
    });
  }

  function claim(
    userId: string,
    nodeId: string,
    who: { keyId: string; label: string | null },
    note: string | null,
  ): WriteClaim {
    const held = covering(userId, nodeId);
    if (held && held.keyId !== who.keyId) throw heldError(held);
    const t = now();
    db.prepare(
      `INSERT INTO mcp_write_claims (user_id, node_id, key_id, label, note, claimed_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, node_id) DO UPDATE SET key_id = excluded.key_id, label = excluded.label,
         note = excluded.note, claimed_at = excluded.claimed_at, expires_at = excluded.expires_at`,
    ).run(userId, nodeId, who.keyId, who.label, note, t, t + WRITE_CLAIM_TTL_MS);
    return live(userId, nodeId) as WriteClaim;
  }

  function release(userId: string, nodeId: string, keyId: string): boolean {
    const c = live(userId, nodeId);
    if (c && c.keyId !== keyId) throw heldError(c, "release");
    return (
      db
        .prepare("DELETE FROM mcp_write_claims WHERE user_id = ? AND node_id = ?")
        .run(userId, nodeId).changes > 0
    );
  }

  /**
   * Refuse a write by this key into nodes another key is writing for; renew
   * the caller's own covering claims.
   */
  function assertFree(userId: string, nodeIds: readonly string[], keyId: string): void {
    for (const nodeId of nodeIds) {
      let held: WriteClaim | null;
      try {
        held = covering(userId, nodeId);
      } catch {
        continue; // a missing node is the domain's error to report
      }
      if (!held) continue;
      if (held.keyId !== keyId) throw heldError(held);
      db.prepare(
        "UPDATE mcp_write_claims SET expires_at = ? WHERE user_id = ? AND node_id = ?",
      ).run(now() + WRITE_CLAIM_TTL_MS, userId, held.nodeId);
    }
  }

  return { live, covering, under, claim, release, assertFree };
}

export type WriteClaims = ReturnType<typeof createWriteClaims>;

function heldError(c: WriteClaim, verb: "write" | "release" = "write"): AppError {
  return new AppError(
    "conflict",
    `${holderName(c)} is writing material for ${c.nodeId} until ${c.expiresAt}${c.note ? ` ("${c.note}")` : ""}, so ${verb === "write" ? "this write is refused to avoid duplicate work" : "only that agent can release it"}.`,
    {
      hint: "Pick other work (another lecture, her requests, the inbox), or come back after the claim ends. A claim lapses on its own after 30 minutes without writes.",
    },
  );
}
