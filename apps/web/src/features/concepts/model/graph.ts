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

/**
 * For every concept beyond the centre, the one link that connects it to a nearer concept.
 * The graph draws only these (a tree), so a dense neighbourhood stays readable; the list and the
 * relation sections still show every link.
 */
export function treeEdges(graph: GraphResult): Map<string, GraphResult["edges"][number]> {
  const dist = distances(graph);
  const out = new Map<string, GraphResult["edges"][number]>();
  for (const n of graph.nodes) {
    const d = dist.get(n.id) ?? 0;
    if (d === 0) continue;
    const edge = graph.edges.find((e) => {
      const other = e.from === n.id ? e.to : e.to === n.id ? e.from : null;
      return other !== null && dist.get(other) === d - 1;
    });
    if (edge) out.set(n.id, edge);
  }
  return out;
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
  const tree = treeEdges(graph);
  const ring1 = graph.nodes.filter((n) => dist.get(n.id) === 1).sort(byType);
  const placed: Placed[] = [{ id: graph.center, x: 0, y: 0, hop: 0 }];
  // Nodes are wide, so the rings are ellipses sized so neighbours on a ring do not touch.
  const base = Math.max(size.width * 1.1, (ring1.length * size.width * 0.78) / (2 * Math.PI));
  const rx1 = base * 1.2;
  const ry1 = Math.max(size.height * 3, base * 0.8);
  const angleOf = new Map<string, number>();
  ring1.forEach((n, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(1, ring1.length)) * 2 * Math.PI;
    angleOf.set(n.id, angle);
    placed.push({ id: n.id, x: Math.cos(angle) * rx1, y: Math.sin(angle) * ry1, hop: 1 });
  });
  const ring2 = graph.nodes.filter((n) => (dist.get(n.id) ?? 0) >= 2).sort(byType);
  const rx2 = rx1 + size.width * 1.3;
  const ry2 = ry1 + size.height * 3.2;
  const byParent = new Map<string, string[]>();
  for (const n of ring2) {
    const link = tree.get(n.id);
    const key = link ? (link.from === n.id ? link.to : link.from) : graph.center;
    byParent.set(key, [...(byParent.get(key) ?? []), n.id]);
  }
  const slot = (2 * Math.PI) / Math.max(ring2.length, 14);
  for (const [parent, ids] of byParent) {
    const base2 = angleOf.get(parent) ?? 0;
    ids.forEach((id, i) => {
      const angle = base2 + (i - (ids.length - 1) / 2) * slot * 1.5;
      placed.push({ id, x: Math.cos(angle) * rx2, y: Math.sin(angle) * ry2, hop: 2 });
    });
  }
  return relax(placed, size);
}

/** Push overlapping boxes apart (the centre stays put); a fixed number of passes keeps it deterministic. */
function relax(placed: Placed[], size: { width: number; height: number }): Placed[] {
  const gapX = 14;
  const gapY = 12;
  const out = placed.map((p) => ({ ...p }));
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i] as Placed;
        const b = out[j] as Placed;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = size.width + gapX - Math.abs(dx);
        const oy = size.height + gapY - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const aFixed = a.hop === 0;
        const share = aFixed ? 1 : 0.5;
        if (oy <= ox) {
          const dir = dy === 0 ? (i % 2 ? 1 : -1) : Math.sign(dy);
          b.y += dir * oy * share;
          if (!aFixed) a.y -= dir * oy * share;
        } else {
          const dir = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx);
          b.x += dir * ox * share;
          if (!aFixed) a.x -= dir * ox * share;
        }
      }
    if (!moved) break;
  }
  return out;
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
