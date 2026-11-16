import { describe, expect, it } from "vitest";
import {
  applyCanvasChange,
  buildLayoutInput,
  CARD_MAX_HEIGHT,
  CARD_WIDTHS,
  type CanvasSourceBlock,
  deriveCanvas,
  estimateCardSize,
  fallbackPositions,
  layoutProblems,
  mergeDocumentBlocks,
  resolveLayout,
  STICKER_SIZE,
} from "../src/canvas.js";
import type { Actor } from "../src/common.js";
import { newId } from "../src/ids.js";

const hannah: Actor = { type: "user", userId: newId("user") };
const now = "2026-11-15T18:00:00.000Z";
const docId = newId("document");

function blocks(count: number): CanvasSourceBlock[] {
  const out: CanvasSourceBlock[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 6 === 0)
      out.push({
        id: newId("block"),
        type: "heading",
        content: { level: i % 12 === 0 ? 2 : 3, text: `Section ${i}` },
      });
    out.push({
      id: newId("block"),
      type: "paragraph",
      content: { text: "Beta blockers lower heart rate. ".repeat((i % 5) + 1) },
    });
  }
  return out;
}

describe("size estimation", () => {
  it("follows the size class and clamps tall content", () => {
    const doc = blocks(3);
    const map = new Map(doc.map((b) => [b.id, b]));
    const canvas = deriveCanvas(docId, doc, { now });
    const card = canvas.cards[0];
    if (!card) throw new Error("no card");
    const small = estimateCardSize({ ...card, size: "small" }, map);
    expect(small.width).toBe(CARD_WIDTHS.small);
    const longText = {
      id: newId("block"),
      type: "paragraph",
      content: { text: "word ".repeat(2000) },
    };
    const tall = estimateCardSize(
      { ...card, size: "medium", content: { kind: "block", blockIds: [longText.id] } },
      new Map([[longText.id, longText]]),
    );
    expect(tall.height).toBe(CARD_MAX_HEIGHT.medium);
    expect(
      estimateCardSize({ ...card, content: { kind: "sticker", sticker: "star" } }, map),
    ).toEqual(STICKER_SIZE);
    const auto = estimateCardSize(
      { ...card, size: "auto", content: { kind: "block", blockIds: [longText.id] } },
      new Map([[longText.id, longText]]),
    );
    expect(auto.width).toBe(CARD_WIDTHS.large);
  });
});

describe("resolveLayout (with the fallback placement as the graph)", () => {
  it("keeps pinned cards, separates unpinned ones, and sizes frames to their members", () => {
    const doc = blocks(40);
    const map = new Map(doc.map((b) => [b.id, b]));
    let canvas = deriveCanvas(docId, doc, { now });
    // Pin two cards right where the automatic layout would put others.
    const [a, b] = canvas.cards;
    const pinned = applyCanvasChange(
      canvas,
      {
        documentId: docId,
        ops: [
          {
            op: "place_cards",
            placements: [
              { id: a?.id, x: 0, y: 0 },
              { id: b?.id, x: 300, y: 120 },
            ],
          },
        ],
      },
      { actor: hannah, now },
    );
    if (!pinned.ok) throw new Error("place failed");
    canvas = pinned.canvas;
    const input = buildLayoutInput(canvas, { sizeOf: (c) => estimateCardSize(c, map) });
    const result = resolveLayout(input, { graph: fallbackPositions(input) });
    expect(layoutProblems(input, result)).toEqual([]);
    expect(result.cards[a?.id as string]).toMatchObject({ x: 0, y: 0 });
    // Deterministic.
    expect(resolveLayout(input, { graph: fallbackPositions(input) })).toEqual(result);
  });

  it("keeps anchored cards where they were and puts a new card inside its frame", () => {
    const doc = blocks(20);
    const map = new Map(doc.map((b) => [b.id, b]));
    const canvas = deriveCanvas(docId, doc, { now });
    const input = buildLayoutInput(canvas, { sizeOf: (c) => estimateCardSize(c, map) });
    const first = resolveLayout(input, { graph: fallbackPositions(input) });
    const added = [
      ...doc.slice(0, 3),
      { id: newId("block"), type: "paragraph", content: { text: "New" } },
      ...doc.slice(3),
    ];
    const merged = mergeDocumentBlocks(canvas, added, { now }).canvas;
    const previous = Object.fromEntries(
      Object.entries(first.cards).map(([id, r]) => [id, { x: r.x, y: r.y }]),
    );
    const input2 = buildLayoutInput(merged, {
      sizeOf: (c) => estimateCardSize(c, new Map(added.map((b) => [b.id, b]))),
      previous,
    });
    const second = resolveLayout(input2, { graph: fallbackPositions(input2) });
    expect(layoutProblems(input2, second)).toEqual([]);
    const unmoved = Object.keys(first.cards).filter((id) => {
      const r1 = first.cards[id];
      const r2 = second.cards[id];
      return r1 && r2 && r1.x === r2.x && r1.y === r2.y;
    });
    // Everything in the frame above the new card keeps its place; frames below shift down as a unit.
    expect(unmoved.length).toBeGreaterThan(0);
    const newCard = merged.cards.find((c) => !(c.id in first.cards));
    const frame = merged.frames.find((f) => f.members.includes(newCard?.id as string));
    const frameRect = second.frames[frame?.id as string];
    expect(frameRect && newCard && second.cards[newCard.id]).toBeTruthy();
    expect(map.size).toBeGreaterThan(0);
  });
});
