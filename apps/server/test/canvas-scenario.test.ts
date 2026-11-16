import { canvasIntegrityProblems } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { canvasSetup } from "./canvas-helpers.js";

const para = (text: string) => ({ type: "paragraph", content: { text }, generalKnowledge: true });
const heading = (text: string) => ({ type: "heading", content: { level: 2, text } });
const block = (...blockIds: string[]) => ({ kind: "block", blockIds });

describe("a study map across a regenerated guide", () => {
  it("her pins, note and sticker survive the agent's regeneration and re-set; new cards arrive unpinned", () => {
    const s = canvasSetup();
    const doc = s.makeDoc(
      [
        "# Beta blockers",
        "## Mechanism",
        "Block beta receptors.",
        "Lower heart rate.",
        "## Selectivity",
        "Atenolol is beta-1 selective.",
        "Propranolol is non-selective.",
        "## Effects",
        "Lower blood pressure.",
        "Reduced cardiac output.",
        "## Cautions",
        "Avoid in asthma.",
        "Never stop abruptly.",
      ],
      { title: "Beta blockers" },
    );
    const ids = doc.blockIds;
    // 1. The agent maps the guide: four frames, labelled connectors.
    const first = s.ok(
      s.services.canvas.setStructure(s.bot, doc.documentId, {
        documentId: doc.documentId,
        cards: [
          { ref: "mech1", content: block(ids[2] as string) },
          { ref: "mech2", content: block(ids[3] as string) },
          { ref: "sel1", content: block(ids[5] as string) },
          { ref: "sel2", content: block(ids[6] as string) },
          { ref: "eff1", content: block(ids[8] as string) },
          { ref: "eff2", content: block(ids[9] as string) },
          { ref: "cau1", content: block(ids[11] as string) },
          { ref: "cau2", content: block(ids[12] as string) },
        ],
        connectors: [
          { from: "mech1", to: "mech2", label: "so", kind: "leads_to" },
          { from: "mech2", to: "eff1", label: "lowers", kind: "causes" },
          { from: "sel1", to: "cau1", label: "safer in", kind: "related" },
          { from: "sel2", to: "cau1", label: "worse in", kind: "contrasts" },
        ],
        frames: [
          { ref: "fm", title: "Mechanism", members: ["mech1", "mech2"] },
          { ref: "fs", title: "Selectivity", members: ["sel1", "sel2"] },
          { ref: "fe", title: "Effects", members: ["eff1", "eff2"] },
          { ref: "fc", title: "Cautions", members: ["cau1", "cau2"] },
        ],
      }),
    );
    expect(first.canvas.frames).toHaveLength(4);
    expect(first.canvas.connectors.map((e) => e.label)).toEqual([
      "so",
      "lowers",
      "safer in",
      "worse in",
    ]);
    expect(s.activity().map((e) => e.summary)).toContain(
      "Arranged the study map for Beta blockers into 4 frames",
    );

    // 2. She drags three cards, adds a note and a sticker (into a frame).
    const refs = first.report.refs;
    const dragged = [refs.mech1, refs.sel1, refs.cau2] as string[];
    s.place(
      doc.documentId,
      dragged.map((id, i) => ({ id, x: 100 + i * 400, y: 60 })),
    );
    const added = s.ok(
      s.sheDoes(doc.documentId, [
        {
          op: "add_card",
          card: {
            ref: "note",
            content: { kind: "note", text: "Exam: beta-1 = heart" },
            color: "yellow",
          },
        },
        { op: "add_card", card: { ref: "star", content: { kind: "sticker", sticker: "star" } } },
        { op: "add_to_frame", frame: refs.fe, cards: ["note", "star"] },
      ]),
    );
    const noteId = added.report.refs.note as string;
    const starId = added.report.refs.star as string;

    // 3. The agent regenerates the guide. Her dragged cards' blocks stay (out of scope); the rest is rewritten.
    const keep = new Set(dragged.map((id) => s.blockOfCard(doc.documentId, id)));
    const regenerated = s.t.services.documents.replaceGenerated(s.bot, {
      documentId: doc.documentId,
      scope: ids.filter((id) => !keep.has(id)),
      blocks: [
        heading("Mechanism, rewritten"),
        para("Beta blockers antagonise beta receptors."),
        heading("New: interactions"),
        para("Verapamil adds to bradycardia."),
        para("Digoxin adds to heart block."),
      ],
    } as never);
    expect(regenerated.written).toHaveLength(5);

    // 4. The canvas followed: her pins, note and sticker are intact; new cards are unpinned and unplaced.
    const merged = s.canvasOf(doc.documentId);
    for (const id of dragged)
      expect(merged.cards.find((c) => c.id === id)?.position).not.toBeNull();
    expect(merged.cards.find((c) => c.id === noteId)).toMatchObject({ origin: "user" });
    expect(merged.cards.find((c) => c.id === starId)).toMatchObject({ origin: "user" });
    const fresh = merged.cards.filter(
      (c) =>
        c.content.kind === "block" &&
        c.content.blockIds.some((b) => regenerated.written.includes(b)),
    );
    expect(fresh.length).toBeGreaterThanOrEqual(3);
    expect(fresh.every((c) => c.position === null && c.origin === "document")).toBe(true);
    expect(canvasIntegrityProblems(merged)).toEqual([]);

    // 5. The agent re-sets the structure for the new guide, listing only its own idea of it.
    const bot = s.services.canvas.view(s.bot, doc.documentId);
    expect(bot.ungrouped.length + bot.frames.flatMap((f) => f.cards).length).toBe(
      merged.cards.length,
    );
    const second = s.ok(
      s.services.canvas.setStructure(s.bot, doc.documentId, {
        documentId: doc.documentId,
        cards: fresh.map((c, i) => ({ ref: `n${i}`, content: c.content })),
        connectors: [{ from: "n0", to: "n1", label: "then", kind: "leads_to" }],
        frames: [{ title: "Interactions", members: fresh.map((_, i) => `n${i}`) }],
      }),
    );
    const final = second.canvas;
    for (const id of dragged) expect(final.cards.find((c) => c.id === id)?.position).not.toBeNull();
    expect(final.cards.some((c) => c.id === noteId)).toBe(true);
    expect(final.cards.some((c) => c.id === starId)).toBe(true);
    expect(final.frames.some((f) => f.title === "Interactions")).toBe(true);
    expect(final.frames.find((f) => f.id === refs.fe)).toBeDefined(); // hers by the edit to it
    const stillFresh = final.cards.filter((c) => fresh.some((f) => f.id === c.id));
    expect(stillFresh).toHaveLength(fresh.length);
    expect(stillFresh.every((c) => c.position === null)).toBe(true);
    expect(second.report.skipped.length).toBeGreaterThan(0);
    expect(canvasIntegrityProblems(final)).toEqual([]);
  });
});
