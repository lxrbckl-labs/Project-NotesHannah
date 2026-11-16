import {
  EMPTY_FRAME_SIZE,
  FRAME_PADDING,
  isFreeCard,
  LAYOUT_SPACING,
  type LayoutInput,
  type LayoutResult,
  type Rect,
  resolveLayout,
} from "@notes/schema";
import type { ElkExtendedEdge, ElkNode, LayoutOptions } from "elkjs/lib/elk-api";

/**
 * The graph half of canvas layout: ELK's layered algorithm over the FREE
 * cards (not pinned, not anchored), frames as compound nodes. The pure
 * constraint pass (`resolveLayout` in @notes/schema) then adds pinned and
 * anchored cards and sizes frames. No DOM: runs in Node, in tests and in
 * the layout worker.
 *
 * Hierarchy: ELK's INCLUDE_CHILDREN mode lays the whole hierarchy out in one
 * pass, but measured on our fixtures it stacks every unconnected card of a
 * frame into one tall column, ignores reading order and is about four times
 * slower. SEPARATE_CHILDREN lays each frame out on its own (packing
 * unconnected cards into rows in reading order); a connector that crosses
 * frame boundaries is turned into a proxy edge between the two frames (or
 * top-level items) at their nearest common level, so linked frames still
 * sit next to each other in flow order.
 */

export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
}

const ROOT = "__root";

/** How the map is shaped: wide screens read left to right, a phone top to bottom. */
export interface LayoutShape {
  /** Flow between frames and top-level cards. */
  direction: "RIGHT" | "DOWN";
  /** Flow of connected cards inside a frame. */
  frameDirection: "RIGHT" | "DOWN";
  /** Target width/height of the whole map. */
  aspectRatio: number;
  /** Target width/height inside a frame. */
  frameAspectRatio: number;
}

export const DEFAULT_SHAPE: LayoutShape = {
  direction: "RIGHT",
  frameDirection: "RIGHT",
  aspectRatio: 1.5,
  frameAspectRatio: 1.25,
};

/** The shape that suits a viewport: phones get a tall, top-to-bottom map. */
export function shapeFor(width: number, height: number): LayoutShape {
  if (width < 768)
    return { direction: "DOWN", frameDirection: "DOWN", aspectRatio: 0.5, frameAspectRatio: 0.45 };
  const ratio = Math.min(2, Math.max(0.7, width / Math.max(1, height)));
  return {
    direction: "RIGHT",
    frameDirection: "RIGHT",
    aspectRatio: ratio,
    frameAspectRatio: Math.min(1.4, Math.max(0.9, ratio * 0.9)),
  };
}

function options(kind: "root" | "frame", shape: LayoutShape): LayoutOptions {
  return {
    "elk.algorithm": "layered",
    "elk.direction": kind === "root" ? shape.direction : shape.frameDirection,
    "elk.hierarchyHandling": "SEPARATE_CHILDREN",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.considerModelOrder.components": "MODEL_ORDER",
    "elk.separateConnectedComponents": "true",
    "elk.aspectRatio": String(kind === "root" ? shape.aspectRatio : shape.frameAspectRatio),
    "elk.spacing.nodeNode": String(LAYOUT_SPACING.card),
    "elk.spacing.componentComponent": String(
      kind === "root" ? LAYOUT_SPACING.group : LAYOUT_SPACING.card,
    ),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYOUT_SPACING.layer),
    "elk.spacing.edgeNode": "24",
    "elk.edgeRouting": "SPLINES",
    "elk.randomSeed": "1",
    "elk.padding":
      kind === "root"
        ? "[top=0,left=0,bottom=0,right=0]"
        : `[top=${FRAME_PADDING.top},left=${FRAME_PADDING.side},bottom=${FRAME_PADDING.bottom},right=${FRAME_PADDING.side}]`,
  };
}

/** Build the ELK graph for the free part of a layout input. Exported for tests. */
export function buildElkGraph(input: LayoutInput, shape: LayoutShape = DEFAULT_SHAPE): ElkNode {
  const frameParent = new Map<string, string | null>();
  const known = new Set(input.frames.map((f) => f.id));
  for (const f of input.frames)
    frameParent.set(f.id, f.parent && known.has(f.parent) ? f.parent : null);
  const containerOfCard = new Map<string, string>();
  for (const c of input.cards)
    containerOfCard.set(c.id, c.frame && known.has(c.frame) ? c.frame : ROOT);

  // Which frames hold free cards somewhere below them, and which frames are empty.
  const hasFree = new Set<string>();
  for (const c of input.cards) {
    if (!isFreeCard(c)) continue;
    let f: string | null = c.frame && known.has(c.frame) ? c.frame : null;
    while (f) {
      hasFree.add(f);
      f = frameParent.get(f) ?? null;
    }
  }
  const occupied = new Set<string>();
  for (const c of input.cards) {
    let f: string | null = c.frame && known.has(c.frame) ? c.frame : null;
    while (f) {
      occupied.add(f);
      f = frameParent.get(f) ?? null;
    }
  }
  const included = (frame: string) => hasFree.has(frame) || !occupied.has(frame);

  const nodes = new Map<string, ElkNode>();
  const root: ElkNode = {
    id: ROOT,
    layoutOptions: options("root", shape),
    children: [],
    edges: [],
  };
  nodes.set(ROOT, root);
  for (const f of input.frames) {
    if (!included(f.id)) continue;
    const empty = !occupied.has(f.id) && !input.frames.some((x) => x.parent === f.id);
    nodes.set(
      f.id,
      empty
        ? { id: f.id, width: EMPTY_FRAME_SIZE.width, height: EMPTY_FRAME_SIZE.height }
        : { id: f.id, layoutOptions: options("frame", shape), children: [], edges: [] },
    );
  }
  // Frames are listed parents first, so a parent node exists before its children attach.
  for (const f of input.frames) {
    const node = nodes.get(f.id);
    if (!node) continue;
    const parent = nodes.get(frameParent.get(f.id) ?? ROOT) ?? root;
    parent.children?.push(node);
  }
  for (const c of input.cards) {
    if (!isFreeCard(c)) continue;
    const parent = nodes.get(containerOfCard.get(c.id) ?? ROOT) ?? root;
    parent.children?.push({ id: c.id, width: c.width, height: c.height });
  }

  // Edges: inside one container as they are; across containers as a proxy
  // between the two items at the nearest common level.
  const chain = (id: string): string[] => {
    const out = [id];
    let f: string | null = containerOfCard.get(id) ?? ROOT;
    while (f && f !== ROOT) {
      out.push(f);
      f = frameParent.get(f) ?? ROOT;
    }
    out.push(ROOT);
    return out;
  };
  const freeIds = new Set(input.cards.filter(isFreeCard).map((c) => c.id));
  const seen = new Set<string>();
  for (const e of input.connectors) {
    if (!freeIds.has(e.from) || !freeIds.has(e.to) || e.from === e.to) continue;
    const a = chain(e.from);
    const b = chain(e.to);
    const common = a.find((x) => x !== e.from && b.includes(x)) ?? ROOT;
    const source = a[a.indexOf(common) - 1];
    const target = b[b.indexOf(common) - 1];
    if (!source || !target || source === target) continue;
    if (
      !nodes.has(common) ||
      (source !== e.from && !nodes.has(source)) ||
      (target !== e.to && !nodes.has(target))
    )
      continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const edge: ElkExtendedEdge = { id: `${e.id}:${key}`, sources: [source], targets: [target] };
    nodes.get(common)?.edges?.push(edge);
  }
  return root;
}

/** Absolute rects of every node in an ELK result. */
export function absoluteRects(graph: ElkNode): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  const visit = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      out[child.id] = { x, y, width: child.width ?? 0, height: child.height ?? 0 };
      visit(child, x, y);
    }
  };
  visit(graph, 0, 0);
  return out;
}

export interface TimedLayout extends LayoutResult {
  /** Milliseconds spent in ELK and in the constraint pass. */
  timings: { graph: number; resolve: number };
}

/** Run the full layout: ELK over free cards, then the constraint pass. */
export async function computeLayout(
  input: LayoutInput,
  elk: ElkLike,
  shape: LayoutShape = DEFAULT_SHAPE,
): Promise<TimedLayout> {
  const t0 = performance.now();
  const graph = buildElkGraph(input, shape);
  let rects: Record<string, Rect> = {};
  if ((graph.children?.length ?? 0) > 0) {
    try {
      rects = absoluteRects(await elk.layout(graph));
    } catch {
      rects = {}; // resolveLayout falls back to a simple placement.
    }
  }
  const t1 = performance.now();
  const result = resolveLayout(input, { graph: rects });
  const t2 = performance.now();
  return { ...result, timings: { graph: t1 - t0, resolve: t2 - t1 } };
}
