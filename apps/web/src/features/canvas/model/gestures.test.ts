import {
  applyCanvasChange,
  type Canvas,
  canvasIntegrityProblems,
  framesInOrder,
  type Rect,
} from "@notes/schema";
import { describe, expect, it } from "vitest";
import { buildSeed, DEMO_USER } from "../store/seed";
import { diffOps } from "./diff";
import {
  alignPlacements,
  connectOps,
  deepestFrameAt,
  deleteOps,
  dropOps,
  frameDragPlacements,
  frameFromSelectionOps,
  freeSpot,
  newCardOps,
} from "./gestures";

const now = "2026-11-15T20:00:00.000Z";

function seed() {
  const { document, ref } = buildSeed();
  return { canvas: document.canvas as Canvas, ref };
}

function apply(canvas: Canvas, ops: unknown[]) {
  const result = applyCanvasChange(
    canvas,
    { documentId: canvas.documentId, ops },
    { actor: DEMO_USER, now },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  expect(canvasIntegrityProblems(result.canvas)).toEqual([]);
  return result.canvas;
}

/** Frame rects laid out in a row, 1000 wide each, for drop tests. */
function rects(canvas: Canvas): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  framesInOrder(canvas).forEach((f, i) => {
    out[f.id] = { x: i * 1100, y: 0, width: 1000, height: 800 };
  });
  return out;
}

describe("gestures emit the right ops", () => {
  it("drag and drop: pins the card, and moves it into the frame under its centre", () => {
    const { canvas, ref } = seed();
    const frames = framesInOrder(canvas);
    const r = rects(canvas);
    const id = ref.intro as string; // the seed's refs name cards by their structure ref
    expect(canvas.cards.some((c) => c.id === id)).toBe(true);
    const target = frames[3];
    const { ops, into } = dropOps(canvas, r, [
      { id, x: 3 * 1100 + 100, y: 100, width: 200, height: 100 },
    ]);
    expect(ops[0]).toEqual({ op: "place_cards", placements: [{ id, x: 3400, y: 100 }] });
    expect(ops[1]).toEqual({ op: "add_to_frame", frame: target?.id, cards: [id] });
    expect(into?.id).toBe(target?.id);
    const after = apply(canvas, ops);
    expect(after.frames.find((f) => f.id === target?.id)?.members).toContain(id);
    expect(after.cards.find((c) => c.id === id)?.position).toMatchObject({
      x: 3400,
      y: 100,
      placedBy: DEMO_USER,
    });
  });

  it("drag out of every frame takes the card out; a drop inside its own frame only pins", () => {
    const { canvas } = seed();
    const frame = framesInOrder(canvas)[0];
    const member = frame?.members[0] as string;
    const r = rects(canvas);
    const out = dropOps(canvas, r, [{ id: member, x: -900, y: -900, width: 100, height: 50 }]);
    expect(out.leftFrame).toBe(true);
    expect(out.ops[1]).toEqual({ op: "remove_from_frame", cards: [member] });
    const inside = dropOps(canvas, r, [{ id: member, x: 10, y: 10, width: 100, height: 50 }]);
    expect(inside.ops).toHaveLength(1);
    expect(inside.into).toBeNull();
  });

  it("dragging a frame pins every card inside it", () => {
    const { canvas } = seed();
    const frame = framesInOrder(canvas)[0];
    const positions = new Map((frame?.members ?? []).map((m, i) => [m, { x: i * 10.4, y: 5.6 }]));
    const placements = frameDragPlacements(canvas, frame?.id as string, positions);
    expect(placements.map((p) => p.id)).toEqual(frame?.members);
    expect(placements[1]).toEqual({ id: frame?.members[1], x: 10, y: 6 });
  });

  it("a new note or sticker is hers, pinned, and joins the frame it lands in", () => {
    const { canvas } = seed();
    const r = rects(canvas);
    const { ops, card } = newCardOps(
      canvas,
      r,
      {
        id: "crd_01JZZZZZZZZZZZZZZZZZZZZZZZ",
        content: { kind: "sticker", sticker: "heart" },
        size: "auto",
      },
      { x: 1200, y: 100, width: 88, height: 88 },
      DEMO_USER,
      now,
    );
    expect(card.origin).toBe("user");
    expect(ops[1]).toEqual({
      op: "add_to_frame",
      frame: framesInOrder(canvas)[1]?.id,
      cards: [card.id],
    });
    const after = apply(canvas, ops);
    expect(after.cards.find((c) => c.id === card.id)?.position).toMatchObject({ x: 1200, y: 100 });
  });

  it("finds a free spot for a new card", () => {
    const taken = [{ x: 0, y: 0, width: 100, height: 100 }];
    expect(freeSpot(taken, { x: 10, y: 10 }, { width: 50, height: 50 })).toEqual({
      x: 122,
      y: 122,
    });
    expect(freeSpot([], { x: 10.4, y: 10.6 }, { width: 50, height: 50 })).toEqual({ x: 10, y: 11 });
  });

  it("connect: one connector, never a self-link", () => {
    const { canvas } = seed();
    const [a, b] = canvas.cards;
    expect(connectOps(a?.id as string, a?.id as string, "edg_01JZZZZZZZZZZZZZZZZZZZZZZZ")).toEqual(
      [],
    );
    const ops = connectOps(
      a?.id as string,
      b?.id as string,
      "edg_01JZZZZZZZZZZZZZZZZZZZZZZZ",
      "treats",
    );
    const after = apply(canvas, ops);
    expect(after.connectors.at(-1)).toMatchObject({
      from: a?.id,
      to: b?.id,
      kind: "treats",
      origin: "user",
    });
  });

  it("delete: cards, frames (cards kept) and connectors, with a summary; undo restores all", () => {
    const { canvas } = seed();
    const frame = framesInOrder(canvas)[0];
    const edge = canvas.connectors[0];
    const loose = canvas.cards.find((c) => !canvas.frames.some((f) => f.members.includes(c.id)));
    const { ops, summary } = deleteOps(
      canvas,
      new Set([frame?.id as string, edge?.id as string, loose?.id as string]),
    );
    expect(summary).toBe("Deleted 1 card, 1 frame (cards kept), 1 connector");
    const after = apply(canvas, ops);
    expect(after.cards).toHaveLength(canvas.cards.length - 1);
    // Undo is the diff back to the snapshot.
    const undone = apply(after, diffOps(after, canvas));
    expect(undone.cards.map((c) => c.id).sort()).toEqual(canvas.cards.map((c) => c.id).sort());
    expect(undone.connectors.map((c) => c.id).sort()).toEqual(
      canvas.connectors.map((c) => c.id).sort(),
    );
    expect(undone.frames.map((f) => [f.id, f.members])).toEqual(
      expect.arrayContaining(canvas.frames.map((f) => [f.id, f.members])),
    );
  });

  it("frame from selection nests inside the frame the cards share", () => {
    const { canvas } = seed();
    const outer = framesInOrder(canvas)[1];
    const members = outer?.members.slice(0, 2) as string[];
    const after = apply(
      canvas,
      frameFromSelectionOps(canvas, members, "frm_01JZZZZZZZZZZZZZZZZZZZZZZZ"),
    );
    const inner = after.frames.find((f) => f.id === "frm_01JZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(inner?.parent).toBe(outer?.id);
    expect(inner?.members).toEqual(members);
    expect(after.frames.find((f) => f.id === outer?.id)?.members).not.toContain(members[0]);
  });

  it("align helpers", () => {
    const cards = [
      { id: "a", x: 10, y: 50, width: 100, height: 40 },
      { id: "b", x: 300, y: 20, width: 200, height: 40 },
      { id: "c", x: 700, y: 80, width: 100, height: 40 },
    ];
    expect(alignPlacements(cards, "left").map((p) => p.x)).toEqual([10, 10, 10]);
    expect(alignPlacements(cards, "top").map((p) => p.y)).toEqual([20, 20, 20]);
    const centred = alignPlacements(cards, "center");
    expect(new Set(centred.map((p, i) => p.x + (cards[i]?.width ?? 0) / 2)).size).toBe(1);
    const spaced = alignPlacements(cards, "distribute");
    expect(spaced.map((p) => p.x)).toEqual([10, 305, 700]);
    expect(alignPlacements(cards.slice(0, 1), "left")).toEqual([]);
  });

  it("finds the innermost frame at a point", () => {
    const { canvas } = seed();
    const [a, b] = framesInOrder(canvas);
    const r = {
      [a?.id as string]: { x: 0, y: 0, width: 500, height: 500 },
      [b?.id as string]: { x: 100, y: 100, width: 50, height: 50 },
    };
    expect(deepestFrameAt(canvas, r, 120, 120)?.id).toBe(b?.id);
    expect(deepestFrameAt(canvas, r, 10, 10)?.id).toBe(a?.id);
    expect(deepestFrameAt(canvas, r, 900, 900)).toBeNull();
  });
});

describe("diffOps (undo and redo)", () => {
  it("round-trips placement, edits, membership and order", () => {
    const { canvas } = seed();
    const [f1, f2] = framesInOrder(canvas);
    const card = f1?.members[0] as string;
    const edge = canvas.connectors[0];
    const changed = apply(canvas, [
      { op: "place_cards", placements: [{ id: card, x: 5, y: 6, width: 300, height: 200 }] },
      { op: "update_card", id: card, patch: { color: "pink", title: "Mine" } },
      { op: "update_connector", id: edge?.id, patch: { label: "new", kind: "treats" } },
      { op: "add_to_frame", frame: f2?.id, cards: [card] },
      { op: "update_frame", id: f2?.id, patch: { order: 0, title: "Renamed" } },
    ]);
    const back = apply(changed, diffOps(changed, canvas));
    const strip = (c: Canvas) => ({
      cards: c.cards
        .map(({ origin: _o, ...rest }) => rest)
        .sort((a, b) => a.id.localeCompare(b.id)),
      connectors: c.connectors.map(({ origin: _o, ...rest }) => rest),
      frames: c.frames
        .map(({ origin: _o, ...rest }) => rest)
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
    expect(strip(back)).toEqual(strip(canvas));
    expect(diffOps(canvas, canvas)).toEqual([]);
  });
});
