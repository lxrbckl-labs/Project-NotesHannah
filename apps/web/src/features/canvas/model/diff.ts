import type { Canvas, CanvasOp, Card, Connector, Frame } from "@notes/schema";

/**
 * The ops that turn `from` into `to`: how undo and redo travel through the
 * same validated path as every other change (and reach the server as ops,
 * so they merge with an agent's concurrent changes instead of overwriting
 * them). Origins and timestamps are not reverted.
 */
export function diffOps(from: Canvas, to: Canvas): CanvasOp[] {
  const ops: CanvasOp[] = [];
  const fromCards = new Map(from.cards.map((c) => [c.id, c]));
  const toCards = new Map(to.cards.map((c) => [c.id, c]));
  const fromEdges = new Map(from.connectors.map((e) => [e.id, e]));
  const toEdges = new Map(to.connectors.map((e) => [e.id, e]));
  const fromFrames = new Map(from.frames.map((f) => [f.id, f]));
  const toFrames = new Map(to.frames.map((f) => [f.id, f]));

  for (const e of from.connectors)
    if (!toEdges.has(e.id)) ops.push({ op: "remove_connector", id: e.id });
  for (const f of from.frames) if (!toFrames.has(f.id)) ops.push({ op: "remove_frame", id: f.id });
  for (const c of from.cards) if (!toCards.has(c.id)) ops.push({ op: "remove_card", id: c.id });

  const cards: Card[] = to.cards.filter((c) => !fromCards.has(c.id));
  const connectors: Connector[] = to.connectors.filter((e) => !fromEdges.has(e.id));
  const frames: Frame[] = to.frames.filter((f) => !fromFrames.has(f.id));
  if (cards.length || connectors.length || frames.length)
    ops.push({ op: "insert_items", cards, connectors, frames });

  const place: Array<{ id: string; x: number; y: number; width?: number; height?: number }> = [];
  const release: string[] = [];
  for (const target of to.cards) {
    const current = fromCards.get(target.id);
    if (!current) continue;
    const patch: Extract<CanvasOp, { op: "update_card" }>["patch"] = {};
    if (JSON.stringify(current.content) !== JSON.stringify(target.content))
      patch.content = target.content;
    if (current.size !== target.size) patch.size = target.size;
    if (current.color !== target.color) patch.color = target.color ?? null;
    if (current.title !== target.title) patch.title = target.title ?? null;
    if (Object.keys(patch).length) ops.push({ op: "update_card", id: target.id, patch });
    const samePin =
      current.position?.x === target.position?.x &&
      current.position?.y === target.position?.y &&
      current.dimensions?.width === target.dimensions?.width &&
      current.dimensions?.height === target.dimensions?.height;
    if (!samePin) {
      if (current.position || current.dimensions) release.push(target.id);
      if (target.position)
        place.push({
          id: target.id,
          x: target.position.x,
          y: target.position.y,
          ...(target.dimensions
            ? { width: target.dimensions.width, height: target.dimensions.height }
            : {}),
        });
    }
  }
  if (release.length) ops.push({ op: "release_pins", ids: release });
  if (place.length) ops.push({ op: "place_cards", placements: place });

  for (const target of to.connectors) {
    const current = fromEdges.get(target.id);
    if (!current) continue;
    if (JSON.stringify({ ...current, origin: "" }) === JSON.stringify({ ...target, origin: "" }))
      continue;
    ops.push({
      op: "update_connector",
      id: target.id,
      patch: {
        from: target.from,
        to: target.to,
        label: target.label ?? null,
        kind: target.kind,
        line: target.line ?? null,
        direction: target.direction,
      },
    });
  }
  for (const target of to.frames) {
    const current = fromFrames.get(target.id);
    if (!current) continue;
    const patch: Extract<CanvasOp, { op: "update_frame" }>["patch"] = {};
    if (current.title !== target.title) patch.title = target.title;
    if (current.color !== target.color) patch.color = target.color ?? null;
    if (current.parent !== target.parent) patch.parent = target.parent ?? null;
    if (current.order !== target.order) patch.order = target.order;
    if (Object.keys(patch).length) ops.push({ op: "update_frame", id: target.id, patch });
  }

  // Membership last, once every card and frame exists.
  const frameOf = (canvas: Canvas) => {
    const map = new Map<string, string>();
    for (const f of canvas.frames) for (const m of f.members) map.set(m, f.id);
    return map;
  };
  const before = frameOf(from);
  const after = frameOf(to);
  const leaving = to.cards
    .filter((c) => fromCards.has(c.id) && before.has(c.id) && !after.has(c.id))
    .map((c) => c.id);
  if (leaving.length) ops.push({ op: "remove_from_frame", cards: leaving });
  for (const target of to.frames) {
    const current = fromFrames.get(target.id);
    if (!current) continue;
    if (JSON.stringify(current.members) === JSON.stringify(target.members)) continue;
    const stay = current.members.filter((m) => toCards.has(m));
    if (stay.length) ops.push({ op: "remove_from_frame", cards: stay });
    if (target.members.length)
      ops.push({ op: "add_to_frame", frame: target.id, cards: target.members });
  }
  return ops;
}
