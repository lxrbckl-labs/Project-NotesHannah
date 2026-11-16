import { canvasIntegrityProblems } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { canvasSetup, GUIDE } from "./canvas-helpers.js";

const note = (text: string) => ({ kind: "note", text });
const revisionOf = (s: ReturnType<typeof canvasSetup>, id: string) =>
  (
    s.db.prepare("SELECT revision FROM canvases WHERE document_id = ?").get(id) as
      | { revision: number }
      | undefined
  )?.revision;

/** Open the canvas, pin the first two block cards, and add her note and a sticker. */
function openedWithPins() {
  const s = canvasSetup();
  const doc = s.makeDoc();
  const c = s.canvasOf(doc.documentId);
  const blockCards = c.cards.filter((x) => x.content.kind === "block");
  s.place(doc.documentId, [
    { id: blockCards[0]?.id as string, x: 10, y: 10 },
    { id: blockCards[1]?.id as string, x: 500, y: 10 },
  ]);
  s.ok(
    s.sheDoes(doc.documentId, [
      { op: "add_card", card: { ref: "n", content: note("Mine") } },
      { op: "add_card", card: { ref: "st", content: { kind: "sticker", sticker: "star" } } },
    ]),
  );
  return { s, doc, pinned: [blockCards[0]?.id as string, blockCards[1]?.id as string] };
}

const pinnedCards = (s: ReturnType<typeof canvasSetup>, documentId: string) =>
  s
    .canvasOf(documentId)
    .cards.filter((c) => c.position)
    .map((c) => c.id)
    .sort();

describe("canvas follows the document's blocks", () => {
  it("a new block and a new heading appear as unpinned cards and frames, in the same write", () => {
    const { s, doc, pinned } = openedWithPins();
    const before = revisionOf(s, doc.documentId) as number;
    const inserted = s.services.documents.insertBlocks(s.bot, {
      documentId: doc.documentId,
      blocks: [
        { type: "heading", content: { level: 2, text: "Interactions" } },
        {
          type: "paragraph",
          content: { text: "Verapamil adds to bradycardia." },
          generalKnowledge: true,
        },
      ],
      position: "end",
    } as never);
    // No read in between: the canvas row itself moved with the document write.
    expect(revisionOf(s, doc.documentId)).toBe(before + 1);
    const c = s.canvasOf(doc.documentId);
    const newCard = c.cards.find(
      (x) =>
        x.content.kind === "block" && x.content.blockIds.includes(inserted.blockIds[1] as string),
    );
    expect(newCard).toMatchObject({ origin: "document", position: null, dimensions: null });
    expect(
      c.frames.some((f) => f.title === "Interactions" && f.members.includes(newCard?.id as string)),
    ).toBe(true);
    expect(pinnedCards(s, doc.documentId)).toEqual([...pinned].sort());
    expect(canvasIntegrityProblems(c)).toEqual([]);
    expect(
      s.changes().some((e) => e.action === "canvas.merged" && e.documentId === doc.documentId),
    ).toBe(true);
  });

  it("deleting a block removes its card and connectors; pinned cards of other blocks stay", () => {
    const { s, doc, pinned } = openedWithPins();
    const victim = s
      .canvasOf(doc.documentId)
      .cards.find((c) => !pinned.includes(c.id) && c.content.kind === "block");
    s.ok(
      s.botDoes(doc.documentId, [
        { op: "add_connector", connector: { from: victim?.id, to: pinned[0], label: "x" } },
      ]),
    );
    const blockId = s.blockOfCard(doc.documentId, victim?.id as string);
    s.services.documents.deleteBlocks(s.she, {
      documentId: doc.documentId,
      blockIds: [blockId],
    } as never);
    const c = s.canvasOf(doc.documentId);
    expect(c.cards.some((x) => x.id === victim?.id)).toBe(false);
    expect(c.connectors).toHaveLength(0);
    expect(pinnedCards(s, doc.documentId)).toEqual([...pinned].sort());
    expect(canvasIntegrityProblems(c)).toEqual([]);
  });

  it("moving blocks changes nothing on the canvas: no duplicates, pins and ids kept", () => {
    const { s, doc, pinned } = openedWithPins();
    const before = s.canvasOf(doc.documentId);
    s.services.documents.moveBlocks(s.she, {
      documentId: doc.documentId,
      blockIds: [doc.blockIds[7] as string],
      position: "start",
    } as never);
    const after = s.canvasOf(doc.documentId);
    expect(after.cards.map((c) => c.id).sort()).toEqual(before.cards.map((c) => c.id).sort());
    expect(new Set(after.cards.map((c) => c.id)).size).toBe(after.cards.length);
    expect(pinnedCards(s, doc.documentId)).toEqual([...pinned].sort());
  });

  it("regenerating the guide drops cards of replaced blocks, adds unpinned cards for new ones, keeps pins of kept blocks", () => {
    const { s, doc, pinned } = openedWithPins();
    // Keep the two pinned cards' blocks out of the regeneration's scope.
    const keep = new Set(pinned.map((id) => s.blockOfCard(doc.documentId, id)));
    const scope = doc.blockIds.filter((id) => !keep.has(id));
    const out = s.services.documents.replaceGenerated(s.bot, {
      documentId: doc.documentId,
      scope,
      blocks: [
        { type: "heading", content: { level: 2, text: "Rewritten" } },
        { type: "paragraph", content: { text: "Fresh one." }, generalKnowledge: true },
        { type: "paragraph", content: { text: "Fresh two." }, generalKnowledge: true },
      ],
    } as never);
    const c = s.canvasOf(doc.documentId);
    const blockIdsOnCards = c.cards.flatMap((x) =>
      x.content.kind === "block" ? x.content.blockIds : [],
    );
    expect(new Set(blockIdsOnCards).size).toBe(blockIdsOnCards.length);
    for (const id of out.removed) expect(blockIdsOnCards).not.toContain(id);
    for (const id of out.written) {
      const card = c.cards.find(
        (x) => x.content.kind === "block" && x.content.blockIds.includes(id),
      );
      if (card) expect(card.position).toBeNull();
    }
    expect(blockIdsOnCards.length).toBeGreaterThan(0);
    expect(pinnedCards(s, doc.documentId)).toEqual([...pinned].sort());
    expect(
      c.cards.filter((x) => x.content.kind === "note" || x.content.kind === "sticker"),
    ).toHaveLength(2);
    expect(canvasIntegrityProblems(c)).toEqual([]);
  });

  it("restoring an older revision keeps the canvas consistent", () => {
    const { s, doc } = openedWithPins();
    s.services.documents.deleteBlocks(s.she, {
      documentId: doc.documentId,
      blockIds: [doc.blockIds[2] as string],
    } as never);
    s.services.documents.restoreRevision(s.she, {
      documentId: doc.documentId,
      revision: 1,
    } as never);
    const c = s.canvasOf(doc.documentId);
    const shown = c.cards.flatMap((x) => (x.content.kind === "block" ? x.content.blockIds : []));
    // The restored document has the same block ids again; the canvas shows each exactly once.
    expect(new Set(shown).size).toBe(shown.length);
    expect(canvasIntegrityProblems(c)).toEqual([]);
  });

  it("a document that has no canvas yet is left alone until first read", () => {
    const s = canvasSetup();
    const doc = s.makeDoc();
    s.services.documents.insertBlocks(s.she, {
      documentId: doc.documentId,
      blocks: [{ type: "divider" }],
      position: "end",
    } as never);
    expect(revisionOf(s, doc.documentId)).toBeUndefined();
    expect(s.canvasOf(doc.documentId).cards).toHaveLength(5);
  });
});

describe("canvas follows the library node", () => {
  it("is hidden while the node is in the trash, comes back intact on restore, and goes when deleted for good", () => {
    const { s, doc, pinned } = openedWithPins();
    s.services.library.trash(s.alice, doc.nodeId, s.she.actor);
    expect(() => s.services.canvas.get(s.she, doc.documentId)).toThrow(/No such document/);
    expect(() => s.services.canvas.assertVisible(s.she, doc.documentId)).toThrow();
    s.services.library.restore(s.alice, doc.nodeId, s.she.actor);
    expect(pinnedCards(s, doc.documentId)).toEqual([...pinned].sort());
    s.services.library.trash(s.alice, doc.nodeId, s.she.actor);
    s.services.library.permanentDelete(s.alice, doc.nodeId, s.she.actor);
    expect(revisionOf(s, doc.documentId)).toBeUndefined();
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM canvas_layout_cache").get()).toEqual({ n: 0 });
  });

  it("duplicating deep-copies the canvas with fresh ids, remapped blocks, and her pins", () => {
    const s = canvasSetup();
    const doc = s.makeDoc(GUIDE);
    s.ok(
      s.services.canvas.setStructure(s.bot, doc.documentId, {
        documentId: doc.documentId,
        cards: [
          { ref: "a", content: { kind: "block", blockIds: [doc.blockIds[2]] } },
          { ref: "b", content: { kind: "block", blockIds: [doc.blockIds[5]] } },
        ],
        connectors: [{ from: "a", to: "b", label: "leads", kind: "leads_to" }],
        frames: [{ ref: "f", title: "Everything", members: ["a", "b"] }],
      }),
    );
    const a = s.canvasOf(doc.documentId).cards[0];
    s.place(doc.documentId, [{ id: a?.id as string, x: 77, y: 88 }]);
    s.ok(s.sheDoes(doc.documentId, [{ op: "add_card", card: { content: note("copy me") } }]));

    const course = s.services.library.get(s.alice, doc.nodeId);
    const copy = s.services.library.duplicate(s.alice, course.id, s.she.actor);
    const copyDoc = s.services.documents.getDocumentByNode(s.she, copy.id);
    const original = s.canvasOf(doc.documentId);
    const copied = s.canvasOf(copyDoc.document.id);
    expect(copied.documentId).toBe(copyDoc.document.id);
    expect(copied.revision).toBe(1);
    expect(copied.cards).toHaveLength(original.cards.length);
    const ids = new Set(original.cards.map((c) => c.id));
    expect(copied.cards.every((c) => !ids.has(c.id))).toBe(true);
    expect(copied.frames.every((f) => !original.frames.some((o) => o.id === f.id))).toBe(true);
    expect(copied.connectors[0]).toMatchObject({ label: "leads", kind: "leads_to" });
    const copiedBlocks = copyDoc.blocks.map((b) => b.id);
    const shown = copied.cards.flatMap((c) =>
      c.content.kind === "block" ? c.content.blockIds : [],
    );
    expect(shown.every((id) => copiedBlocks.includes(id))).toBe(true);
    expect(copied.cards.find((c) => c.position)?.position).toMatchObject({ x: 77, y: 88 });
    expect(copied.cards.some((c) => c.content.kind === "note")).toBe(true);
    expect(canvasIntegrityProblems(copied)).toEqual([]);
    // Editing the copy leaves the original alone.
    s.ok(s.sheDoes(copyDoc.document.id, [{ op: "remove_card", id: copied.cards[0]?.id }]));
    expect(s.canvasOf(doc.documentId).cards).toHaveLength(original.cards.length);
  });

  it("a duplicated document without a canvas derives its own", () => {
    const s = canvasSetup();
    const doc = s.makeDoc(GUIDE);
    const copy = s.services.library.duplicate(s.alice, doc.nodeId, s.she.actor);
    const copyDoc = s.services.documents.getDocumentByNode(s.she, copy.id);
    expect(s.canvasOf(copyDoc.document.id).cards).toHaveLength(5);
  });
});
