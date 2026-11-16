import type { Actor, Canvas, CanvasOp, Card, ConnectorKind, Frame, Rect } from "@notes/schema";

/**
 * What each gesture means, as canvas ops. Pure, so every gesture's effect
 * is tested without a browser; the view only measures and calls these.
 */

type Placement = { id: string; x: number; y: number };

/** The smallest frame containing a point (the innermost when frames nest). */
export function deepestFrameAt(
  canvas: Pick<Canvas, "frames">,
  frames: Record<string, Rect>,
  x: number,
  y: number,
): Frame | null {
  let best: Frame | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const f of canvas.frames) {
    const r = frames[f.id];
    if (!r) continue;
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
      const area = r.width * r.height;
      if (area < bestArea) {
        best = f;
        bestArea = area;
      }
    }
  }
  return best;
}

export interface DroppedCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Cards dropped after a drag: pin them where they landed, and move each into
 * the frame under its centre (or out of its frame when dropped outside).
 * Returns the ops and the frame moved into, if any, for the message.
 */
export function dropOps(
  canvas: Canvas,
  frameRects: Record<string, Rect>,
  dropped: DroppedCard[],
): { ops: CanvasOp[]; into: Frame | null; leftFrame: boolean } {
  const placements = dropped.map((d) => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y) }));
  const membership: CanvasOp[] = [];
  let into: Frame | null = null;
  let leftFrame = false;
  for (const d of dropped) {
    const target = deepestFrameAt(canvas, frameRects, d.x + d.width / 2, d.y + d.height / 2);
    const current = canvas.frames.find((f) => f.members.includes(d.id));
    if (target && target.id !== current?.id) {
      membership.push({ op: "add_to_frame", frame: target.id, cards: [d.id] });
      into ??= target;
    } else if (!target && current) {
      membership.push({ op: "remove_from_frame", cards: [d.id] });
      leftFrame = true;
    }
  }
  if (placements.length === 0) return { ops: membership, into, leftFrame };
  return { ops: [{ op: "place_cards", placements }, ...membership], into, leftFrame };
}

/** A frame dragged by its title: every card inside it (nested frames included) is pinned where it now is. */
export function frameDragPlacements(
  canvas: Canvas,
  frameId: string,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): Placement[] {
  const family = new Set([frameId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of canvas.frames)
      if (f.parent && family.has(f.parent) && !family.has(f.id)) {
        family.add(f.id);
        grew = true;
      }
  }
  const ids = canvas.frames.filter((f) => family.has(f.id)).flatMap((f) => f.members);
  return ids
    .map((id) => {
      const at = positions.get(id);
      return at ? { id, x: Math.round(at.x), y: Math.round(at.y) } : null;
    })
    .filter((p): p is Placement => p !== null);
}

/** A new card she creates (note or sticker), pinned where she put it, inside the frame there. */
export function newCardOps(
  canvas: Canvas,
  frameRects: Record<string, Rect>,
  card: Omit<Card, "position" | "dimensions" | "origin">,
  at: { x: number; y: number; width: number; height: number },
  actor: Actor,
  now: string,
): { ops: CanvasOp[]; card: Card } {
  const full: Card = {
    ...card,
    origin: "user",
    position: { x: Math.round(at.x), y: Math.round(at.y), placedBy: actor, placedAt: now },
    dimensions: null,
  };
  const ops: CanvasOp[] = [{ op: "insert_items", cards: [full], connectors: [], frames: [] }];
  const frame = deepestFrameAt(canvas, frameRects, at.x + at.width / 2, at.y + at.height / 2);
  if (frame) ops.push({ op: "add_to_frame", frame: frame.id, cards: [full.id] });
  return { ops, card: full };
}

/** Nudge a new card diagonally until it sits on no other card. */
export function freeSpot(
  taken: readonly Rect[],
  at: { x: number; y: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  let { x, y } = at;
  for (let i = 0; i < 30; i++) {
    const hit = taken.some(
      (r) =>
        x < r.x + r.width && r.x < x + size.width && y < r.y + r.height && r.y < y + size.height,
    );
    if (!hit) break;
    x += 28;
    y += 28;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** Connect two cards: by dragging from a handle, or connect mode's tap then tap. */
export function connectOps(
  from: string,
  to: string,
  edgeId: string,
  kind: ConnectorKind = "related",
): CanvasOp[] {
  if (from === to) return [];
  return [
    {
      op: "insert_items",
      cards: [],
      frames: [],
      connectors: [{ id: edgeId, from, to, kind, direction: "forward", origin: "user" }],
    },
  ];
}

/** Delete what is selected. Frames go but their cards stay. */
export function deleteOps(
  canvas: Canvas,
  selected: ReadonlySet<string>,
): { ops: CanvasOp[]; summary: string } {
  const ops: CanvasOp[] = [];
  const edges = canvas.connectors.filter((e) => selected.has(e.id));
  const frames = canvas.frames.filter((f) => selected.has(f.id));
  const cards = canvas.cards.filter((c) => selected.has(c.id));
  for (const e of edges) ops.push({ op: "remove_connector", id: e.id });
  for (const f of frames) ops.push({ op: "remove_frame", id: f.id });
  for (const c of cards) ops.push({ op: "remove_card", id: c.id });
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
  const parts: string[] = [];
  if (cards.length) parts.push(plural(cards.length, "card"));
  if (frames.length) parts.push(`${plural(frames.length, "frame")} (cards kept)`);
  if (edges.length) parts.push(plural(edges.length, "connector"));
  return { ops, summary: parts.length ? `Deleted ${parts.join(", ")}` : "" };
}

/** A frame around the selected cards; nested in their frame when they share one. */
export function frameFromSelectionOps(
  canvas: Canvas,
  cardIds: string[],
  frameId: string,
): CanvasOp[] {
  const parents = new Set(cardIds.map((m) => canvas.frames.find((f) => f.members.includes(m))?.id));
  const parent = parents.size === 1 ? [...parents][0] : undefined;
  const frame: Frame = {
    id: frameId,
    title: "New frame",
    members: cardIds,
    order: canvas.frames.length,
    origin: "user",
    ...(parent ? { parent } : {}),
  };
  return [{ op: "insert_items", cards: [], connectors: [], frames: [frame] }];
}

export type Alignment = "left" | "top" | "center" | "distribute";

/** Align helpers for two or more selected cards; returns the new pins. */
export function alignPlacements(cards: DroppedCard[], how: Alignment): Placement[] {
  if (cards.length < 2) return [];
  const out = cards.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  if (how === "left") {
    const x = Math.min(...cards.map((c) => c.x));
    for (const p of out) p.x = x;
  } else if (how === "top") {
    const y = Math.min(...cards.map((c) => c.y));
    for (const p of out) p.y = y;
  } else if (how === "center") {
    const cx = cards.reduce((s, c) => s + c.x + c.width / 2, 0) / cards.length;
    cards.forEach((c, i) => {
      (out[i] as Placement).x = Math.round(cx - c.width / 2);
    });
  } else {
    const sorted = [...cards].sort((a, b) => a.x - b.x);
    const first = sorted[0] as DroppedCard;
    const last = sorted[sorted.length - 1] as DroppedCard;
    const total = sorted.reduce((s, c) => s + c.width, 0);
    const gap = Math.max(16, (last.x + last.width - first.x - total) / (sorted.length - 1));
    let x = first.x;
    for (const c of sorted) {
      const p = out.find((q) => q.id === c.id) as Placement;
      p.x = Math.round(x);
      x += c.width + gap;
    }
  }
  return out.map((p) => ({ ...p, x: Math.round(p.x), y: Math.round(p.y) }));
}
