import { describe, expect, it } from "vitest";
import {
  applyCanvasChange,
  applySetStructure,
  CANVAS_EXAMPLES,
  CANVAS_LIMITS,
  CANVAS_OP_EXAMPLES,
  CANVAS_OP_NAMES,
  type Canvas,
  Canvas as CanvasSchema,
  type CanvasSourceBlock,
  canvasIntegrityProblems,
  cardProtection,
  deriveCanvas,
  framesInOrder,
  mergeDocumentBlocks,
  validateCanvasChange,
  validateSetStructure,
} from "../src/canvas.js";
import type { Actor } from "../src/common.js";
import { newId } from "../src/ids.js";

const agent: Actor = { type: "agent", keyId: newId("apiKey"), label: "Claude Code" };
const hannah: Actor = { type: "user", userId: newId("user") };
const now = "2026-11-15T18:00:00.000Z";
const docId = newId("document");
const requestId = newId("request");

/** Deterministic IDs so expectations can name them. */
function ids() {
  let n = 0;
  return (kind: "card" | "edge" | "frame") => {
    n += 1;
    return newId(kind, 1_700_000_000_000 + n);
  };
}

const b = (type: string, content: unknown = {}): CanvasSourceBlock => ({
  id: newId("block"),
  type,
  content,
});
const h = (level: number, text: string) => b("heading", { level, text });
const p = (text: string) => b("paragraph", { text });

function studyGuide() {
  const blocks = [
    h(1, "Beta blockers"),
    p("Beta blockers antagonise β-adrenergic receptors."),
    h(2, "Mechanism"),
    p("Block β1 in the heart: lower rate and contractility."),
    b("callout", { kind: "exam_tip", text: "β1 = 1 heart, β2 = 2 lungs" }),
    b("divider"),
    h(2, "Adverse effects"),
    b("bulleted_list", { items: ["Bradycardia", "Fatigue", "Bronchospasm"] }),
    h(3, "Masked hypoglycaemia"),
    p("Tremor and tachycardia are blunted; sweating remains."),
  ];
  return blocks;
}

function baseCanvas(): { canvas: Canvas; blocks: CanvasSourceBlock[] } {
  const blocks = studyGuide();
  return { canvas: deriveCanvas(docId, blocks, { now, newId: ids() }), blocks };
}

function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok)
    throw new Error(JSON.stringify((result as { problems?: unknown }).problems, null, 2));
  return result as Extract<T, { ok: true }>;
}

describe("canvas schema", () => {
  it("accepts every example", () => {
    expect(validateSetStructure(CANVAS_EXAMPLES.setStructure).ok).toBe(true);
    expect(validateCanvasChange(CANVAS_EXAMPLES.change).ok).toBe(true);
    for (const name of CANVAS_OP_NAMES) {
      const result = validateCanvasChange({ documentId: docId, ops: [CANVAS_OP_EXAMPLES[name]] });
      expect(result.ok, name).toBe(true);
    }
  });

  it("derives a stored canvas that parses", () => {
    const { canvas } = baseCanvas();
    expect(CanvasSchema.safeParse(canvas).success).toBe(true);
    expect(canvasIntegrityProblems(canvas)).toEqual([]);
  });
});

describe("validateSetStructure teaches", () => {
  const card = (ref: string) => ({ ref, content: { kind: "note", text: ref } });

  it("names a missing connector end, with the refs it knows", () => {
    const result = validateSetStructure({
      documentId: docId,
      cards: [card("a"), card("b")],
      connectors: [{ from: "a", to: "c" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.path).toBe("$.connectors[0].to");
    expect(result.problems[0]?.message).toMatch(/"c" is not a card.*Refs in this request: a, b/);
    expect(result.problems[0]?.example).toEqual(CANVAS_EXAMPLES.connector);
  });

  it("refuses self-links unless allowed", () => {
    const body = { documentId: docId, cards: [card("a")], connectors: [{ from: "a", to: "a" }] };
    const refused = validateSetStructure(body);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.problems[0]?.message).toMatch(/itself/);
    expect(validateSetStructure({ ...body, allowSelfLinks: true }).ok).toBe(true);
  });

  it("puts a card in one frame only, and checks frame parents, cycles and depth", () => {
    const twoFrames = validateSetStructure({
      documentId: docId,
      cards: [card("a")],
      frames: [
        { title: "One", members: ["a"] },
        { title: "Two", members: ["a"] },
      ],
    });
    expect(twoFrames.ok).toBe(false);
    if (!twoFrames.ok) {
      expect(twoFrames.problems[0]?.path).toBe("$.frames[1].members[0]");
      expect(twoFrames.problems[0]?.message).toMatch(/one frame at most/);
    }
    const badParent = validateSetStructure({
      documentId: docId,
      cards: [],
      frames: [{ title: "One", parent: "nowhere" }],
    });
    expect(!badParent.ok && badParent.problems[0]?.path).toBe("$.frames[0].parent");
    const loop = validateSetStructure({
      documentId: docId,
      cards: [],
      frames: [
        { ref: "x", title: "X", parent: "y" },
        { ref: "y", title: "Y", parent: "x" },
      ],
    });
    expect(!loop.ok && loop.problems.some((p) => /loop/.test(p.message))).toBe(true);
    const deep = validateSetStructure({
      documentId: docId,
      cards: [],
      frames: [
        { ref: "a", title: "A" },
        { ref: "b", title: "B", parent: "a" },
        { ref: "c", title: "C", parent: "b" },
        { ref: "d", title: "D", parent: "c" },
      ],
    });
    expect(!deep.ok && deep.problems.some((p) => /at most 3 deep/.test(p.message))).toBe(true);
  });

  it("explains that coordinates are not accepted", () => {
    const result = validateSetStructure({
      documentId: docId,
      cards: [{ ref: "a", content: { kind: "note", text: "x" }, x: 10, y: 20 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.path)).toEqual(["$.cards[0].x", "$.cards[0].y"]);
    expect(result.problems[0]?.message).toMatch(/agents describe structure/);
  });

  it("checks blocks belong to the document, and limits", () => {
    const stranger = newId("block");
    const result = validateSetStructure(
      { documentId: docId, cards: [{ content: { kind: "block", blockIds: [stranger] } }] },
      { documentBlockIds: [] },
    );
    expect(!result.ok && result.problems[0]?.message).toMatch(/not in this document/);

    const tooMany = validateSetStructure({
      documentId: docId,
      cards: Array.from({ length: CANVAS_LIMITS.cards + 1 }, (_, i) => card(`c${i}`)),
    });
    expect(!tooMany.ok && tooMany.problems[0]?.message).toMatch(/at most 500 cards/);

    const long = validateSetStructure({
      documentId: docId,
      cards: [{ content: { kind: "note", text: "x".repeat(CANVAS_LIMITS.noteChars + 1) } }],
    });
    expect(!long.ok && long.problems[0]?.path).toBe("$.cards[0].content.text");

    const kind = validateSetStructure({
      documentId: docId,
      cards: [{ content: { kind: "picture" } }],
    });
    expect(!kind.ok && kind.problems[0]?.message).toMatch(/one of block, concept, note, sticker/);
  });

  it("names unknown ops and lists the valid ones", () => {
    const result = validateCanvasChange({ documentId: docId, ops: [{ op: "move_card", id: "x" }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.path).toBe("$.ops[0].op");
    expect(result.problems[0]?.message).toMatch(/Valid ops: add_card/);
  });
});

describe("deriveCanvas", () => {
  it("turns headings into nested frames and blocks into cards in reading order", () => {
    const { canvas, blocks } = baseCanvas();
    const frames = framesInOrder(canvas);
    expect(frames.map((f) => f.title)).toEqual([
      "Beta blockers",
      "Mechanism",
      "Adverse effects",
      "Masked hypoglycaemia",
    ]);
    const [top, mech, adverse, hypo] = frames;
    expect(mech?.parent).toBe(top?.id);
    expect(adverse?.parent).toBe(top?.id);
    expect(hypo?.parent).toBe(adverse?.id);
    // Paragraph, paragraph, callout, list, paragraph: the divider and headings make no card.
    expect(canvas.cards).toHaveLength(5);
    const blockOf = (cardId: string) => {
      const c = canvas.cards.find((x) => x.id === cardId);
      return c?.content.kind === "block" ? c.content.blockIds[0] : undefined;
    };
    expect(mech?.members.map(blockOf)).toEqual([blocks[3]?.id, blocks[4]?.id]);
    expect(top?.members.map(blockOf)).toEqual([blocks[1]?.id]);
    expect(canvas.cards.every((c) => c.position === null && c.origin === "document")).toBe(true);
    expect(canvas.syncedBlockIds).toEqual(blocks.map((x) => x.id));
    expect(canvasIntegrityProblems(canvas)).toEqual([]);
  });

  it("drops frames for headings with nothing under them", () => {
    const canvas = deriveCanvas(docId, [h(2, "Empty"), h(2, "Full"), p("text")], { now });
    expect(canvas.frames.map((f) => f.title)).toEqual(["Full"]);
    expect(canvas.frames[0]?.order).toBe(0);
  });
});

describe("mergeDocumentBlocks", () => {
  it("adds new blocks as unpinned cards beside their neighbors and keeps pins", () => {
    const { canvas, blocks } = baseCanvas();
    const mech = framesInOrder(canvas)[1];
    const first = mech?.members[0] as string;
    const pinned = expectOk(
      applyCanvasChange(
        canvas,
        {
          documentId: docId,
          ops: [{ op: "place_cards", placements: [{ id: first, x: 400, y: 120 }] }],
        },
        { actor: hannah, now },
      ),
    ).canvas;
    const added = p("Also lowers renin release.");
    const nextBlocks = [...blocks.slice(0, 4), added, ...blocks.slice(4)];
    const result = mergeDocumentBlocks(pinned, nextBlocks, { now, newId: ids() });
    expect(result.changed).toBe(true);
    expect(result.addedCards).toHaveLength(1);
    const card = result.canvas.cards.find((c) => c.id === result.addedCards[0]);
    expect(card?.position).toBeNull();
    const frame = result.canvas.frames.find((f) => f.id === mech?.id);
    expect(frame?.members.indexOf(card?.id as string)).toBe(1);
    expect(result.canvas.cards.find((c) => c.id === first)?.position).toMatchObject({
      x: 400,
      y: 120,
    });
    expect(result.canvas.revision).toBe(pinned.revision + 1);
    expect(canvasIntegrityProblems(result.canvas)).toEqual([]);
  });

  it("removes cards of deleted blocks, trims multi-block cards and drops derived frames of deleted headings", () => {
    const { canvas, blocks } = baseCanvas();
    // Make one card show two blocks.
    const list = blocks[7] as CanvasSourceBlock;
    const last = blocks[9] as CanvasSourceBlock;
    const target = canvas.cards.find(
      (c) => c.content.kind === "block" && c.content.blockIds[0] === list.id,
    );
    const both = expectOk(
      applyCanvasChange(
        canvas,
        {
          documentId: docId,
          ops: [
            {
              op: "update_card",
              id: target?.id,
              patch: { content: { kind: "block", blockIds: [list.id, last.id] } },
            },
          ],
        },
        { actor: hannah, now },
      ),
    ).canvas;
    const withoutHeading = blocks.filter((x) => x.id !== blocks[2]?.id && x.id !== last.id);
    const result = mergeDocumentBlocks(both, withoutHeading, { now });
    const trimmed = result.canvas.cards.find((c) => c.id === target?.id);
    expect(trimmed?.content).toEqual({ kind: "block", blockIds: [list.id] });
    expect(result.removedFrames).toHaveLength(1);
    expect(result.canvas.frames.map((f) => f.title)).not.toContain("Mechanism");
    // The mechanism cards survive, ungrouped into the parent frame; the card of the
    // deleted last paragraph is gone.
    expect(result.canvas.cards).toHaveLength(4);
    expect(canvasIntegrityProblems(result.canvas)).toEqual([]);
    // The card that showed only the deleted paragraph is gone.
    const solo = mergeDocumentBlocks(
      result.canvas,
      withoutHeading.filter((x) => x.id !== list.id),
      { now },
    );
    expect(solo.removedCards).toEqual([target?.id]);
  });

  it("adds a frame for a new heading and is a no-op when nothing changed", () => {
    const { canvas, blocks } = baseCanvas();
    const same = mergeDocumentBlocks(canvas, blocks, { now });
    expect(same.changed).toBe(false);
    expect(same.canvas).toBe(canvas);
    const more = [...blocks, h(2, "Counseling"), p("Do not stop suddenly.")];
    const result = mergeDocumentBlocks(canvas, more, { now });
    expect(result.addedFrames).toHaveLength(1);
    const frame = result.canvas.frames.find((f) => f.id === result.addedFrames[0]);
    expect(frame?.title).toBe("Counseling");
    expect(frame?.parent).toBe(framesInOrder(canvas)[0]?.id);
    expect(frame?.members).toEqual(result.addedCards);
  });
});

describe("applySetStructure and the pin rule", () => {
  function agentStructure(canvas: Canvas, blocks: CanvasSourceBlock[]) {
    const ids = (i: number) => (blocks[i] as CanvasSourceBlock).id;
    return {
      documentId: docId,
      cards: [
        { ref: "mech", content: { kind: "block", blockIds: [ids(3)] } },
        { ref: "tip", content: { kind: "block", blockIds: [ids(4)] }, color: "yellow" },
        { ref: "effects", content: { kind: "block", blockIds: [ids(7)] }, size: "wide" },
        { ref: "note", content: { kind: "note", text: "-olol = beta blocker" } },
      ],
      connectors: [{ from: "mech", to: "effects", kind: "causes", label: "too much blockade" }],
      frames: [
        { ref: "m", title: "Mechanism", members: ["mech", "tip", "note"] },
        { ref: "a", title: "Adverse effects", members: ["effects"] },
      ],
      expectedRevision: canvas.revision,
    };
  }

  it("matches block cards to existing ones, so their pins survive, and is idempotent", () => {
    const { canvas, blocks } = baseCanvas();
    const mechCard = canvas.cards.find(
      (c) => c.content.kind === "block" && c.content.blockIds[0] === blocks[3]?.id,
    );
    const placed = expectOk(
      applyCanvasChange(
        canvas,
        {
          documentId: docId,
          ops: [
            {
              op: "place_cards",
              placements: [{ id: mechCard?.id, x: 10, y: 20, width: 300, height: 200 }],
            },
          ],
        },
        { actor: hannah, now },
      ),
    ).canvas;
    const body = agentStructure(placed, blocks);
    const first = expectOk(
      applySetStructure(placed, body, {
        actor: agent,
        now,
        documentBlockIds: blocks.map((x) => x.id),
      }),
    );
    expect(first.report.refs.mech).toBe(mechCard?.id);
    const after = first.canvas.cards.find((c) => c.id === mechCard?.id);
    expect(after?.position).toMatchObject({ x: 10, y: 20, placedBy: hannah });
    expect(after?.dimensions).toMatchObject({ width: 300, height: 200 });
    expect(first.canvas.connectors).toHaveLength(1);
    expect(first.canvas.connectors[0]?.label).toBe("too much blockade");
    // Unlisted derived cards went; the pinned one stayed by matching.
    expect(first.canvas.cards).toHaveLength(4);
    expect(canvasIntegrityProblems(first.canvas)).toEqual([]);

    const again = expectOk(
      applySetStructure(
        first.canvas,
        { ...body, expectedRevision: first.canvas.revision },
        { actor: agent, now },
      ),
    );
    expect(again.report).toMatchObject({ added: [], updated: [], removed: [] });
    expect(again.changed).toBe(false);
    expect(again.canvas.revision).toBe(first.canvas.revision);
  });

  it("keeps cards she made or pinned when an agent leaves them out, and reports them", () => {
    const { canvas, blocks } = baseCanvas();
    const withMine = expectOk(
      applyCanvasChange(
        canvas,
        {
          documentId: docId,
          ops: [
            {
              op: "add_card",
              card: { ref: "mine", content: { kind: "note", text: "my own note" } },
            },
          ],
        },
        { actor: hannah, now },
      ),
    );
    const mine = withMine.report.refs.mine as string;
    const unlisted = withMine.canvas.cards.find(
      (c) => c.content.kind === "block" && c.content.blockIds[0] === blocks[1]?.id,
    );
    const pinned = expectOk(
      applyCanvasChange(
        withMine.canvas,
        {
          documentId: docId,
          ops: [{ op: "place_cards", placements: [{ id: unlisted?.id, x: 0, y: 0 }] }],
        },
        { actor: hannah, now },
      ),
    ).canvas;
    const result = expectOk(
      applySetStructure(pinned, agentStructure(pinned, blocks), { actor: agent, now }),
    );
    expect(result.canvas.cards.some((c) => c.id === mine)).toBe(true);
    expect(result.canvas.cards.some((c) => c.id === unlisted?.id)).toBe(true);
    expect(result.report.skipped.map((s) => s.reason).sort()).toEqual(["pinned", "user_edited"]);
    expect(result.report.skipped[0]?.message).toMatch(/requestId/);

    // With her request, the agent may clear them.
    const asked = expectOk(
      applySetStructure(
        pinned,
        { ...agentStructure(pinned, blocks), requestId },
        { actor: agent, now },
      ),
    );
    expect(asked.canvas.cards.some((c) => c.id === mine)).toBe(false);
    expect(asked.report.skipped).toEqual([]);
  });

  it("does not let an agent rewrite a card she edited", () => {
    const { canvas, blocks } = baseCanvas();
    const { expectedRevision: _, ...body } = agentStructure(canvas, blocks);
    const first = expectOk(applySetStructure(canvas, body, { actor: agent, now }));
    const tip = first.report.refs.tip as string;
    const edited = expectOk(
      applyCanvasChange(
        first.canvas,
        { documentId: docId, ops: [{ op: "update_card", id: tip, patch: { color: "pink" } }] },
        { actor: hannah, now },
      ),
    ).canvas;
    expect(edited.cards.find((c) => c.id === tip)?.origin).toBe("user");
    const second = expectOk(applySetStructure(edited, body, { actor: agent, now }));
    expect(second.canvas.cards.find((c) => c.id === tip)?.color).toBe("pink");
    expect(second.report.skipped).toEqual([
      expect.objectContaining({ id: tip, reason: "user_edited" }),
    ]);
  });

  it("refuses a stale revision", () => {
    const { canvas, blocks } = baseCanvas();
    const result = applySetStructure(
      canvas,
      { ...agentStructure(canvas, blocks), expectedRevision: 99 },
      { actor: agent, now },
    );
    expect(!result.ok && result.problems[0]?.message).toMatch(/Conflict/);
  });
});

describe("applyCanvasChange", () => {
  it("refuses placement from agents, with the reason", () => {
    const { canvas } = baseCanvas();
    const id = canvas.cards[0]?.id;
    for (const op of [
      { op: "place_cards", placements: [{ id, x: 0, y: 0 }] },
      { op: "release_pins" },
    ]) {
      const result = applyCanvasChange(
        canvas,
        { documentId: docId, ops: [op] },
        { actor: agent, now },
      );
      expect(!result.ok && result.problems[0]?.message).toMatch(/hers alone/);
    }
  });

  it("records who placed a card, and releases pins", () => {
    const { canvas } = baseCanvas();
    const [a, b2] = canvas.cards;
    const placed = expectOk(
      applyCanvasChange(
        canvas,
        {
          documentId: docId,
          ops: [
            {
              op: "place_cards",
              placements: [
                { id: a?.id, x: 1, y: 2 },
                { id: b2?.id, x: 3, y: 4, width: 200, height: 100 },
              ],
            },
          ],
        },
        { actor: hannah, now },
      ),
    ).canvas;
    expect(placed.cards[0]?.position).toEqual({ x: 1, y: 2, placedBy: hannah, placedAt: now });
    expect(placed.cards[0]?.origin).toBe("document");
    expect(cardProtection(placed.cards[0] as never)).toBe("pinned");
    const one = expectOk(
      applyCanvasChange(
        placed,
        { documentId: docId, ops: [{ op: "release_pins", ids: [a?.id] }] },
        { actor: hannah, now },
      ),
    ).canvas;
    expect(one.cards[0]?.position).toBeNull();
    expect(one.cards[1]?.position).not.toBeNull();
    const all = expectOk(
      applyCanvasChange(
        one,
        { documentId: docId, ops: [{ op: "release_pins" }] },
        { actor: hannah, now },
      ),
    ).canvas;
    expect(all.cards.every((c) => c.position === null && c.dimensions === null)).toBe(true);
  });

  it("never lets an agent resize or remove a pinned card", () => {
    const { canvas } = baseCanvas();
    const id = canvas.cards[0]?.id;
    const placed = expectOk(
      applyCanvasChange(
        canvas,
        { documentId: docId, ops: [{ op: "place_cards", placements: [{ id, x: 5, y: 5 }] }] },
        { actor: hannah, now },
      ),
    ).canvas;
    const resize = applyCanvasChange(
      placed,
      { documentId: docId, ops: [{ op: "update_card", id, patch: { size: "wide" } }] },
      { actor: agent, now },
    );
    expect(!resize.ok && resize.problems[0]?.path).toBe("$.ops[0].patch.size");
    const remove = applyCanvasChange(
      placed,
      { documentId: docId, ops: [{ op: "remove_card", id }] },
      { actor: agent, now },
    );
    expect(!remove.ok && remove.problems[0]?.message).toMatch(/placed this card by hand/);
    const recolour = expectOk(
      applyCanvasChange(
        placed,
        { documentId: docId, ops: [{ op: "update_card", id, patch: { color: "blue" } }] },
        { actor: agent, now },
      ),
    );
    expect(recolour.canvas.cards[0]?.position).toMatchObject({ x: 5, y: 5 });
    const asked = applyCanvasChange(
      placed,
      { documentId: docId, ops: [{ op: "remove_card", id }], requestId },
      { actor: agent, now },
    );
    expect(asked.ok).toBe(true);
  });

  it("applies ops in order with local refs, all or nothing", () => {
    const { canvas } = baseCanvas();
    const target = canvas.cards[0]?.id;
    const result = expectOk(
      applyCanvasChange(
        canvas,
        {
          documentId: docId,
          ops: [
            {
              op: "add_card",
              card: { ref: "n", content: { kind: "note", text: "Watch heart rate" } },
            },
            {
              op: "add_card",
              card: { ref: "s", content: { kind: "sticker", sticker: "warning" } },
            },
            {
              op: "add_connector",
              connector: { from: "n", to: target, kind: "leads_to", label: "check" },
            },
            { op: "add_frame", frame: { ref: "f", title: "Monitoring", members: ["n", "s"] } },
          ],
        },
        { actor: agent, now, newId: ids() },
      ),
    );
    expect(Object.keys(result.report.refs)).toEqual(["n", "s", "f"]);
    const frame = result.canvas.frames.find((f) => f.id === result.report.refs.f);
    expect(frame?.members).toEqual([result.report.refs.n, result.report.refs.s]);
    expect(frame?.origin).toBe("agent");
    expect(canvasIntegrityProblems(result.canvas)).toEqual([]);

    const broken = applyCanvasChange(
      canvas,
      {
        documentId: docId,
        ops: [
          { op: "add_card", card: { ref: "n", content: { kind: "note", text: "x" } } },
          { op: "add_connector", connector: { from: "n", to: "missing" } },
        ],
      },
      { actor: agent, now },
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.problems[0]?.path).toBe("$.ops[1].connector.to");
  });

  it("removing a card removes its connectors and frame membership; removing a frame ungroups", () => {
    const { canvas } = baseCanvas();
    const frames = framesInOrder(canvas);
    const mech = frames[1];
    const [m1, m2] = mech?.members ?? [];
    const linked = expectOk(
      applyCanvasChange(
        canvas,
        { documentId: docId, ops: [{ op: "add_connector", connector: { from: m1, to: m2 } }] },
        { actor: hannah, now },
      ),
    ).canvas;
    const removed = expectOk(
      applyCanvasChange(
        linked,
        { documentId: docId, ops: [{ op: "remove_card", id: m1 }] },
        { actor: hannah, now },
      ),
    ).canvas;
    expect(removed.connectors).toHaveLength(0);
    expect(removed.frames.find((f) => f.id === mech?.id)?.members).toEqual([m2]);
    const ungrouped = expectOk(
      applyCanvasChange(
        removed,
        { documentId: docId, ops: [{ op: "remove_frame", id: mech?.id }] },
        { actor: hannah, now },
      ),
    ).canvas;
    expect(ungrouped.frames.find((f) => f.id === frames[0]?.id)?.members).toContain(m2);
    expect(canvasIntegrityProblems(ungrouped)).toEqual([]);
  });

  it("moves a card between frames and marks her edits as hers", () => {
    const { canvas } = baseCanvas();
    const [top, mech, adverse] = framesInOrder(canvas);
    const card = mech?.members[0];
    const moved = expectOk(
      applyCanvasChange(
        canvas,
        { documentId: docId, ops: [{ op: "add_to_frame", frame: adverse?.id, cards: [card] }] },
        { actor: hannah, now },
      ),
    ).canvas;
    expect(moved.frames.find((f) => f.id === mech?.id)?.members).not.toContain(card);
    expect(moved.frames.find((f) => f.id === adverse?.id)?.members.at(-1)).toBe(card);
    expect(moved.frames.find((f) => f.id === adverse?.id)?.origin).toBe("user");
    // An agent may not take cards out of her frames now.
    const out = applyCanvasChange(
      moved,
      { documentId: docId, ops: [{ op: "remove_from_frame", cards: [card] }] },
      { actor: agent, now },
    );
    expect(out.ok).toBe(false);
    expect(top).toBeDefined();
  });

  it("reorders frames for step-through", () => {
    const { canvas } = baseCanvas();
    const last = framesInOrder(canvas).at(-1);
    const result = expectOk(
      applyCanvasChange(
        canvas,
        { documentId: docId, ops: [{ op: "update_frame", id: last?.id, patch: { order: 0 } }] },
        { actor: hannah, now },
      ),
    ).canvas;
    expect(framesInOrder(result)[0]?.id).toBe(last?.id);
    expect(canvasIntegrityProblems(result)).toEqual([]);
  });
});

describe("insert_items", () => {
  it("puts deleted items back with their IDs, for undo", () => {
    const { canvas } = baseCanvas();
    const frame = framesInOrder(canvas)[1];
    const [m1, m2] = frame?.members ?? [];
    const linked = applyCanvasChange(
      canvas,
      {
        documentId: docId,
        ops: [{ op: "add_connector", connector: { from: m1, to: m2, label: "then" } }],
      },
      { actor: hannah, now },
    );
    if (!linked.ok) throw new Error("link failed");
    const before = linked.canvas;
    const removed = applyCanvasChange(
      before,
      { documentId: docId, ops: [{ op: "remove_card", id: m1 }] },
      { actor: hannah, now },
    );
    if (!removed.ok) throw new Error("remove failed");
    const card = before.cards.find((c) => c.id === m1);
    const restored = applyCanvasChange(
      removed.canvas,
      {
        documentId: docId,
        ops: [{ op: "insert_items", cards: [card], connectors: before.connectors }],
      },
      { actor: hannah, now },
    );
    if (!restored.ok) throw new Error(JSON.stringify(restored.problems));
    expect(restored.canvas.cards.map((c) => c.id)).toContain(m1);
    expect(restored.canvas.connectors).toHaveLength(1);
    const agentTry = applyCanvasChange(
      removed.canvas,
      { documentId: docId, ops: [{ op: "insert_items", cards: [card] }] },
      { actor: agent, now },
    );
    expect(agentTry.ok).toBe(false);
  });
});
