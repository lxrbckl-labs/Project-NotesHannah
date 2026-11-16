import type { Db } from "../../db/client.js";

/** One library node, as far as practice needs to know it. */
export interface TreeNode {
  id: string;
  parentId: string | null;
  kind: string;
  name: string;
  section: string | null;
  trashed: boolean;
}

/**
 * A read-only view of one user's library tree, loaded in one query. The
 * library tables belong to another domain; practice only reads them to know
 * where a question lives (its lecture and every folder above it).
 */
export interface Tree {
  nodes: ReadonlyMap<string, TreeNode>;
  /** The node, then its parent, up to the root. Empty for an unknown id. */
  chain(id: string): string[];
  /** The node and everything below it (unknown id: empty). */
  subtree(id: string): string[];
  /** "Fall 2026 / Pharmacology II / Lectures" */
  path(id: string): string;
}

interface Row {
  id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  section: string | null;
  trashed_at: string | null;
}

export function loadTree(db: Db, userId: string): Tree {
  const rows = db
    .prepare("SELECT id, parent_id, kind, name, section, trashed_at FROM nodes WHERE user_id = ?")
    .all(userId) as Row[];
  const nodes = new Map<string, TreeNode>();
  const children = new Map<string, string[]>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      parentId: r.parent_id,
      kind: r.kind,
      name: r.name,
      section: r.section,
      trashed: r.trashed_at !== null,
    });
    if (r.parent_id !== null) {
      const list = children.get(r.parent_id) ?? [];
      list.push(r.id);
      children.set(r.parent_id, list);
    }
  }
  const chain = (id: string): string[] => {
    const out: string[] = [];
    let cur = nodes.get(id);
    while (cur && out.length < 64) {
      out.push(cur.id);
      cur = cur.parentId === null ? undefined : nodes.get(cur.parentId);
    }
    return out;
  };
  const subtree = (id: string): string[] => {
    if (!nodes.has(id)) return [];
    const out: string[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      out.push(next);
      for (const child of children.get(next) ?? []) stack.push(child);
    }
    return out;
  };
  const path = (id: string): string =>
    chain(id)
      .reverse()
      .map((n) => nodes.get(n)?.name ?? "")
      .join(" / ");
  return { nodes, chain, subtree, path };
}
