import type { GraphResult, RelationType } from "@notes/schema";

/** Keep only edges of the chosen types, then only concepts still reachable from the centre. */
export function filterGraph(
  graph: GraphResult,
  types: ReadonlySet<RelationType> | null,
): GraphResult {
  const edges = types ? graph.edges.filter((e) => types.has(e.type)) : graph.edges;
  const reached = new Set([graph.center]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) {
      const a = reached.has(e.from);
      const b = reached.has(e.to);
      if (a !== b) {
        reached.add(a ? e.to : e.from);
        grew = true;
      }
    }
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => reached.has(n.id)),
    edges: edges.filter((e) => reached.has(e.from) && reached.has(e.to)),
  };
}

/** Hops from the centre for every concept (breadth first over the edges, either direction). */
export function distances(graph: GraphResult): Map<string, number> {
  const dist = new Map([[graph.center, 0]]);
  let frontier = [graph.center];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier)
      for (const e of graph.edges) {
        const other = e.from === id ? e.to : e.to === id ? e.from : null;
        if (other && !dist.has(other)) {
          dist.set(other, (dist.get(id) ?? 0) + 1);
          next.push(other);
        }
      }
    frontier = next;
  }
  return dist;
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  hop: number;
}

/**
 * A radial layout: the concept in the middle, first neighbours on a ring, second neighbours on an
 * outer ring near their parent. Deterministic, so the picture does not jump between visits.
 * Nodes are placed by their centre; `size` is the node box used for ring spacing.
 */
export function radialLayout(graph: GraphResult, size = { width: 150, height: 44 }): Placed[] {
  const dist = distances(graph);
  const ring1 = graph.nodes.filter((n) => dist.get(n.id) === 1).sort(byType);
  const placed: Placed[] = [{ id: graph.center, x: 0, y: 0, hop: 0 }];
  const r1 = Math.max(
    size.width * 1.35,
    (ring1.length * (size.height + 26)) / (2 * Math.PI) + size.width * 0.5,
  );
  const angleOf = new Map<string, number>();
  ring1.forEach((n, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(1, ring1.length)) * 2 * Math.PI;
    angleOf.set(n.id, angle);
    placed.push({ id: n.id, x: Math.cos(angle) * r1, y: Math.sin(angle) * r1, hop: 1 });
  });
  const ring2 = graph.nodes.filter((n) => (dist.get(n.id) ?? 0) >= 2).sort(byType);
  const r2 = r1 + size.width * 1.25;
  const byParent = new Map<string, string[]>();
  for (const n of ring2) {
    const parent = ring1.find((p) =>
      graph.edges.some(
        (e) => (e.from === p.id && e.to === n.id) || (e.to === p.id && e.from === n.id),
      ),
    );
    const key = parent?.id ?? graph.center;
    byParent.set(key, [...(byParent.get(key) ?? []), n.id]);
  }
  const slot = ring2.length > 0 ? (2 * Math.PI) / Math.max(ring2.length, 12) : 0;
  for (const [parent, ids] of byParent) {
    const base = angleOf.get(parent) ?? 0;
    ids.forEach((id, i) => {
      const angle = base + (i - (ids.length - 1) / 2) * slot * 1.6;
      placed.push({ id, x: Math.cos(angle) * r2, y: Math.sin(angle) * r2, hop: 2 });
    });
  }
  return placed;
}

function byType(a: { type: string; name: string }, b: { type: string; name: string }): number {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
}

/** The concepts one hop from the centre, grouped for the phone's list view. */
export function neighbours(graph: GraphResult): Array<{
  type: RelationType;
  label: string;
  items: Array<{ id: string; name: string; conceptType: string }>;
}> {
  const names = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<
    RelationType,
    Map<string, { id: string; name: string; conceptType: string }>
  >();
  for (const e of graph.edges) {
    const other = e.from === graph.center ? e.to : e.to === graph.center ? e.from : null;
    const node = other ? names.get(other) : undefined;
    if (!other || !node) continue;
    const bucket = out.get(e.type) ?? new Map();
    bucket.set(other, { id: other, name: node.name, conceptType: node.type });
    out.set(e.type, bucket);
  }
  return [...out].map(([type, items]) => ({
    type,
    label: type,
    items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
