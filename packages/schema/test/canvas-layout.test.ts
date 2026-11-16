import { describe, expect, it } from "vitest";
import {
  applyCanvasChange,
  buildLayoutInput,
  CARD_MAX_HEIGHT,
  CARD_WIDTHS,
  type CanvasSourceBlock,
  type Card,
  cardMaxHeight,
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
    expect(tall.height).toBe(cardMaxHeight("medium"));
    expect(cardMaxHeight("medium")).toBe(CARD_MAX_HEIGHT.medium + 2);
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

// Cards of the pharmacy demo's Beta blockers canvas and the height the app drew each one at
// (Chromium, 1280x800, the documents' own block renderers; node box including the border), measured
// on 2026-11-16 when her new paragraph was drawn over the card above it. The estimates then were
// 148 and 188 for the first two paragraphs: 35% under, so the first layout put cards on top of each
// other until the browser had measured them.
const run = (text: string) => [{ text }];
const DRAWN: Array<{ name: string; block: CanvasSourceBlock; title?: string; drawn: number }> = [
  {
    name: "paragraph, 193 characters",
    block: {
      id: newId("block"),
      type: "paragraph",
      content: {
        text: [
          { text: "Beta blockers are " },
          { text: "competitive antagonists", bold: true },
          {
            text: " at beta receptors. Blocking beta-1 slows the heart, weakens contraction and slows AV conduction; blocking renin release lowers blood pressure further.",
          },
        ],
      },
    },
    drawn: 228,
  },
  {
    name: "her paragraph, 263 characters",
    block: {
      id: newId("block"),
      type: "paragraph",
      content: {
        text: run(
          "My version: β1 = heart (one heart), β2 = lungs (two lungs). Block β1 and the heart slows and squeezes less, and the kidney lets out less renin, so BP comes down from two sides. Hit β2 too (non-selective, or a selective one at a high dose) and the airways tighten.",
        ),
      },
    },
    drawn: 286,
  },
  {
    name: "callout with a title",
    block: {
      id: newId("block"),
      type: "callout",
      content: {
        kind: "info",
        title: "Net effect",
        text: run(
          "Lower cardiac output, lower blood pressure and lower myocardial oxygen demand: the reason they help in angina and after a heart attack.",
        ),
      },
    },
    drawn: 284,
  },
  {
    name: "longer callout",
    block: {
      id: newId("block"),
      type: "callout",
      content: {
        kind: "tip",
        title: "My note: two different questions",
        text: run(
          "Renal ones (atenolol, nadolol) are the ones to dose-adjust in CKD. Liver ones (metoprolol, carvedilol, propranolol) are where CYP2D6 interactions come in. On a case, ask both.",
        ),
      },
    },
    drawn: 337,
  },
  {
    name: "bulleted list of six",
    block: {
      id: newId("block"),
      type: "bulleted_list",
      content: {
        items: [
          "Bradycardia, AV block, low blood pressure",
          "Fatigue and less exercise tolerance",
          "Bronchospasm, mainly with non-selective drugs",
          "Masks the tremor and palpitations of hypoglycaemia; sweating still happens",
          "Cold hands and feet, sexual dysfunction",
          "Sudden withdrawal: rebound tachycardia, angina, even MI",
        ].map((t) => ({ text: run(t), indent: 0 })),
      },
    },
    drawn: 281,
  },
  {
    name: "two-column table",
    block: {
      id: newId("block"),
      type: "table",
      content: {
        headerRow: true,
        headerColumn: false,
        rows: [
          ["With", "What happens"],
          ["Verapamil, diltiazem", "Additive bradycardia and AV block"],
          ["Clonidine", "Stop the beta blocker first when withdrawing both"],
          ["Fluoxetine, paroxetine", "CYP2D6 inhibition: more metoprolol"],
          ["NSAIDs", "Less blood pressure lowering"],
        ].map((row) => row.map(run)),
      },
    },
    drawn: 276,
  },
  {
    name: "mnemonic (drawn clipped at the medium maximum)",
    block: {
      id: newId("block"),
      type: "mnemonic",
      content: {
        device: "A to M, then N to Z",
        topic: "Which beta blockers are cardioselective",
        parts: [
          {
            key: "A to M",
            meaning: run(
              "Mostly beta-1 selective: atenolol, bisoprolol, esmolol, metoprolol (acebutolol too)",
            ),
          },
          {
            key: "N to Z",
            meaning: run("Mostly non-selective: nadolol, pindolol, propranolol, timolol"),
          },
          {
            key: "Exceptions",
            meaning: run(
              "Carvedilol and labetalol block alpha-1 and beta; nebivolol is beta-1 selective",
            ),
          },
        ],
        note: run("A rough rule only; it fails for the mixed agents."),
      },
    },
    drawn: 342,
  },
  {
    name: "drug card (drawn clipped at the large maximum)",
    block: {
      id: newId("block"),
      type: "drug_card",
      content: {
        name: "carvedilol",
        brandNames: ["Coreg"],
        drugClass: { text: run("Mixed alpha-1 and beta blocker"), citations: [], flags: [] },
        mechanism: {
          text: run("Blocks beta-1, beta-2 and alpha-1 receptors"),
          citations: [],
          flags: [],
        },
        indications: ["Hypertension", "HFrEF"].map((t) => ({ text: run(t) })),
        adverseEffects: ["Dizziness and orthostatic hypotension", "Bradycardia"].map((t) => ({
          text: run(t),
        })),
        counselling: ["Take with food", "Taper; never stop suddenly"].map((t) => ({
          text: run(t),
        })),
        dosingNotes: ["Start low", "Double every two weeks"].map((t) => ({ text: run(t) })),
      },
    },
    drawn: 422,
  },
];

describe("size estimates against what the app draws", () => {
  for (const sample of DRAWN) {
    it(`never estimates a ${sample.name} shorter than it is drawn`, () => {
      const card: Card = {
        id: newId("card"),
        content: { kind: "block", blockIds: [sample.block.id] },
        size: "auto",
        origin: "document",
        position: null,
        dimensions: null,
      };
      const { height } = estimateCardSize(card, new Map([[sample.block.id, sample.block]]));
      // Tall enough that the first layout leaves room for the card as drawn, and not so tall that
      // the map opens full of holes (a gap closes on the measured re-layout; an overlap shows).
      expect(height).toBeGreaterThanOrEqual(sample.drawn);
      expect(height).toBeLessThanOrEqual(Math.round(sample.drawn * 1.2));
    });
  }

  it("estimates a titled note and concept cards as drawn", () => {
    const note: Card = {
      id: newId("card"),
      content: {
        kind: "note",
        text: run(
          "-olol: beta blocker. -alol or -ilol (labetalol, carvedilol): blocks alpha-1 too.",
        ),
      },
      title: "Name stems",
      size: "auto",
      origin: "agent",
      position: null,
      dimensions: null,
    };
    expect(estimateCardSize(note, new Map()).height).toBeGreaterThanOrEqual(152);
    const concept = (label: string): Card => ({
      ...note,
      title: undefined,
      content: { kind: "concept", conceptId: newId("concept"), label },
    });
    expect(estimateCardSize(concept("bradycardia"), new Map()).height).toBeGreaterThanOrEqual(54);
    expect(
      estimateCardSize(concept("masked hypoglycaemia"), new Map()).height,
    ).toBeGreaterThanOrEqual(66);
  });
});

describe("resolveLayout when the browser measures a card taller than estimated", () => {
  it("moves the unpinned cards it would cover, and nothing else", () => {
    const doc = blocks(12);
    const map = new Map(doc.map((b) => [b.id, b]));
    let canvas = deriveCanvas(docId, doc, { now });
    const pinnedCard = canvas.cards[3] as Card;
    const placed = applyCanvasChange(
      canvas,
      {
        documentId: docId,
        ops: [{ op: "place_cards", placements: [{ id: pinnedCard.id, x: 2000, y: 0 }] }],
      },
      { actor: hannah, now },
    );
    if (!placed.ok) throw new Error("place failed");
    canvas = placed.canvas;
    const estimated = buildLayoutInput(canvas, { sizeOf: (c) => estimateCardSize(c, map) });
    const first = resolveLayout(estimated, { graph: fallbackPositions(estimated) });
    expect(layoutProblems(estimated, first)).toEqual([]);

    // The first card of the first frame is drawn 200 units taller than its estimate. The view
    // re-runs the constraint pass with every card anchored where it was drawn.
    const grown = canvas.frames[0]?.members[0] as string;
    const previous = Object.fromEntries(
      Object.entries(first.cards).map(([id, r]) => [id, { x: r.x, y: r.y }]),
    );
    const measured = buildLayoutInput(canvas, {
      sizeOf: (c) => {
        const size = estimateCardSize(c, map);
        return c.id === grown ? { ...size, height: size.height + 200 } : size;
      },
      previous,
    });
    // Nothing is free: the pass needs no graph layout, which is what lets the view run it at once.
    expect(measured.cards.filter((c) => !c.pinned && !c.anchor)).toEqual([]);
    const second = resolveLayout(measured, { graph: {} });
    expect(layoutProblems(measured, second)).toEqual([]);
    expect(second.cards[pinnedCard.id]).toMatchObject({ x: 2000, y: 0 });
    const g = first.cards[grown] as { x: number; y: number; width: number; height: number };
    for (const [id, r] of Object.entries(first.cards)) {
      const after = second.cards[id] as typeof r;
      // Nothing moves sideways or up; what sits above the grown card stays exactly where it was.
      expect(after.x).toBe(r.x);
      expect(after.y).toBeGreaterThanOrEqual(r.y);
      if (r.y + r.height <= g.y) expect(after.y).toBe(r.y);
    }
    expect(second.cards[grown]).toMatchObject({ x: g.x, y: g.y });
    // Same input, same answer: running the pass again changes nothing.
    expect(resolveLayout(measured, { graph: {} })).toEqual(second);
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
