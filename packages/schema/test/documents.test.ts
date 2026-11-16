import { describe, expect, it } from "vitest";
import {
  type Block,
  type BlockInput,
  blockToInput,
  canAgentOverwrite,
  markReviewed,
  stampEditedBlock,
  stampNewBlock,
  validateBlockInputs,
} from "../src/blocks/index.js";
import type { Actor } from "../src/common.js";
import {
  applyBlockPatch,
  CreateDocumentInput,
  citationIndexRows,
  countUnverified,
  Document,
  DocumentWithBlocks,
  documentPlainText,
  documentReviewStatus,
  insertIds,
  listConceptMentions,
  listReferences,
  moveIds,
  OPERATION_EXAMPLES,
  planRegeneration,
  ReplaceGeneratedResult,
  RestoreRevisionInput,
  Revision,
  resolvePosition,
  restoreRevision,
  snapshotDocument,
  UpdateBlockInput,
  validateOperation,
  WRITER_OPERATIONS,
  writerJsonSchema,
} from "../src/documents.js";
import { newId } from "../src/ids.js";

const agent: Actor = { type: "agent", keyId: newId("apiKey"), label: "Claude Code" };
const hannah: Actor = { type: "user", userId: newId("user") };
const t0 = "2026-11-15T18:00:00.000Z";
const t1 = "2026-11-15T19:00:00.000Z";

// Invented but plausible source material: lecture 7 slides and her handwritten page.
const slides = newId("file");
const slide9 = newId("page");
const slide12 = newId("page");
const notes = newId("file");
const notesPage = newId("page");
const metoprolol = newId("concept");
const propranolol = newId("concept");

const cite = {
  cardioselective: {
    fileId: slides,
    pageId: slide12,
    quote: "Cardioselective (β1): atenolol, metoprolol, bisoprolol",
    label: "Slide 12",
  },
  withdrawal: {
    fileId: slides,
    pageId: slide9,
    quote: "Avoid abrupt withdrawal → rebound tachycardia, angina",
    label: "Slide 9",
  },
  dose: {
    fileId: notes,
    pageId: notesPage,
    quote: "metoprolol tart. 25mg BID → titrate HR 55-60",
    region: { x: 0.1, y: 0.4, width: 0.7, height: 0.08 },
  },
};

/** A beta-blocker study guide as an agent would write it. */
const STUDY_GUIDE: unknown[] = [
  { type: "heading", content: { level: 1, text: "Beta blockers" } },
  {
    type: "paragraph",
    content: {
      text: [
        { text: "Cardioselective agents such as " },
        { concept: metoprolol, text: "metoprolol" },
        { text: " block β1 receptors preferentially" },
        { cite: 1 },
        { text: "; " },
        { concept: propranolol, text: "propranolol" },
        { text: " blocks β1 and β2." },
      ],
    },
    citations: [cite.cardioselective],
  },
  {
    type: "callout",
    content: { kind: "warning", title: "Never stop abruptly", text: "Taper over 1–2 weeks." },
    citations: [cite.withdrawal],
  },
  {
    type: "drug_card",
    content: {
      name: "metoprolol tartrate",
      concept: metoprolol,
      brandNames: ["Lopressor"],
      drugClass: { text: "β1-selective blocker", citations: [cite.cardioselective] },
      adverseEffects: ["Bradycardia", "Fatigue"],
      counselling: [{ text: "Do not stop suddenly", citations: [cite.withdrawal] }],
      dosingNotes: [
        {
          text: "Start 25 mg PO BID; titrate to HR 55–60",
          citations: [cite.dose],
          flags: [{ kind: "dose", quote: "25 mg", note: "Handwritten; check the decimal" }],
        },
      ],
    },
  },
  { type: "divider" },
  {
    type: "mnemonic",
    content: {
      device: "BAD",
      topic: "Cautions",
      parts: [
        { key: "B", meaning: "Bradycardia" },
        { key: "A", meaning: "Asthma" },
        { key: "D", meaning: "Diabetes" },
      ],
    },
    generalKnowledge: true,
  },
];

const BLOCK_PARAGRAPH = {
  type: "paragraph",
  content: { text: "Metoprolol is β1-selective." },
  citations: [cite.cardioselective],
};

function buildGuide(): Block[] {
  const result = validateBlockInputs(STUDY_GUIDE, { writer: "agent" });
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
  return result.blocks.map((block) => stampNewBlock(block, { actor: agent, now: t0 }));
}

function documentOf(blocks: Block[]) {
  return DocumentWithBlocks.parse({
    id: newId("document"),
    nodeId: newId("node"),
    kind: "study_guide",
    title: "Beta blockers",
    blockIds: blocks.map((block) => block.id),
    blocks,
    reviewStatus: documentReviewStatus(blocks),
    revision: 1,
    createdBy: agent,
    createdAt: t0,
    lastEditedBy: agent,
    updatedAt: t0,
    trashedAt: null,
  });
}

describe("documents", () => {
  it("holds an ordered block list whose blocks match", () => {
    const blocks = buildGuide();
    const doc = documentOf(blocks);
    expect(Document.parse(doc).blockIds).toHaveLength(6);
    const swapped = { ...doc, blockIds: [...doc.blockIds].reverse() };
    expect(DocumentWithBlocks.safeParse(swapped).success).toBe(false);
  });

  it("extracts plain text for search", () => {
    const text = documentPlainText(buildGuide());
    expect(text).toContain("Beta blockers\n\nCardioselective agents such as metoprolol block");
    expect(text).toContain("Start 25 mg PO BID");
    expect(text).toContain("BAD");
  });

  it("lists concept mentions with their block", () => {
    const blocks = buildGuide();
    const mentions = listConceptMentions(blocks);
    expect(mentions.map((m) => [m.conceptId, m.text])).toEqual([
      [metoprolol, "metoprolol"],
      [propranolol, "propranolol"],
      [metoprolol, "metoprolol tartrate"],
    ]);
    expect(mentions[0]?.blockId).toBe(blocks[1]?.id);
  });
});

describe("references list (K7)", () => {
  it("numbers distinct passages in order of first appearance and merges repeats", () => {
    const blocks = buildGuide();
    const references = listReferences(blocks);
    expect(references.map((r) => [r.number, r.citation.label ?? r.citation.quote])).toEqual([
      [1, "Slide 12"],
      [2, "Slide 9"],
      [3, cite.dose.quote],
    ]);
    // Slide 12 is cited by the paragraph and by the drug card's class field.
    expect(references[0]?.uses).toEqual([
      { blockId: blocks[1]?.id, field: null },
      { blockId: blocks[3]?.id, field: "$.content.drugClass" },
    ]);
    expect(references[2]?.uses).toEqual([
      { blockId: blocks[3]?.id, field: "$.content.dosingNotes[0]" },
    ]);
  });

  it("produces citation index rows for the reverse lookup (K5)", () => {
    const blocks = buildGuide();
    const rows = citationIndexRows("doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", blocks);
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.pageId === slide9)).toHaveLength(2);
    expect(rows.find((row) => row.pageId === notesPage)?.region).toEqual(cite.dose.region);
  });
});

describe("review state", () => {
  it("counts unverified blocks, ignoring dividers", () => {
    const blocks = buildGuide();
    expect(countUnverified(blocks)).toBe(5);
    const reviewed = blocks.map((block) => markReviewed(block, t1));
    expect(countUnverified(reviewed)).toBe(0);
    expect(documentReviewStatus(reviewed)).toBe("reviewed");
  });

  it("stamps her own blocks as reviewed and protected", () => {
    const result = validateBlockInputs([{ type: "paragraph", content: { text: "My note" } }], {
      writer: "user",
    });
    if (!result.ok) throw new Error("unexpected");
    const [block] = result.blocks.map((b) => stampNewBlock(b, { actor: hannah, now: t0 }));
    expect(block?.origin).toBe("user");
    expect(block?.review).toEqual({ status: "reviewed", reviewedAt: t0 });
    expect(block?.id).toMatch(/^blk_/);
  });
});

describe("edit protection (D11)", () => {
  function editedByHer(block: Block): Block {
    return stampEditedBlock(block, blockToInput(block), { actor: hannah, now: t1 });
  }

  it("lets agents overwrite only unreviewed agent blocks", () => {
    const [heading, paragraph] = buildGuide() as [Block, Block];
    expect(canAgentOverwrite(heading)).toEqual({ allowed: true });
    const mine = editedByHer(paragraph);
    expect(mine.origin).toBe("user");
    expect(mine.provenance.createdBy).toEqual(agent);
    expect(mine.provenance.lastEditedBy).toEqual(hannah);
    const decision = canAgentOverwrite(mine);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("user_edited");
      expect(decision.message).toContain("requestId");
    }
    expect(canAgentOverwrite(markReviewed(heading, t1))).toMatchObject({
      allowed: false,
      reason: "reviewed",
    });
    expect(canAgentOverwrite(mine, { requestId: newId("request") })).toEqual({ allowed: true });
  });

  it("an agent edit makes the block unverified again", () => {
    const [heading] = buildGuide() as [Block];
    const reviewed = markReviewed(heading, t1);
    const edited = stampEditedBlock(reviewed, blockToInput(reviewed), { actor: agent, now: t1 });
    expect(edited.review.status).toBe("unverified");
    expect(edited.id).toBe(heading.id);
  });

  it("regeneration leaves her blocks alone and reports them", () => {
    const blocks = buildGuide();
    const herParagraph = editedByHer(blocks[1] as Block);
    const reviewedCallout = markReviewed(blocks[2] as Block, t1);
    const current = [blocks[0], herParagraph, reviewedCallout, ...blocks.slice(3)] as Block[];

    const incoming = validateBlockInputs(
      [
        { type: "heading", content: { level: 1, text: "Beta blockers (revised)" } },
        BLOCK_PARAGRAPH,
      ],
      { writer: "agent" },
    );
    if (!incoming.ok) throw new Error("unexpected");

    const plan = planRegeneration(current, incoming.blocks, { actor: agent, now: t1 });
    expect(plan.skipped).toEqual([
      { blockId: herParagraph.id, type: "paragraph", reason: "user_edited" },
      { blockId: reviewedCallout.id, type: "callout", reason: "reviewed" },
    ]);
    expect(plan.removed).toEqual([blocks[0]?.id, blocks[3]?.id, blocks[4]?.id, blocks[5]?.id]);
    expect(plan.blocks.map((block) => block.id)).toEqual([
      ...plan.written,
      herParagraph.id,
      reviewedCallout.id,
    ]);
    // Her paragraph is untouched, byte for byte.
    expect(plan.blocks.find((block) => block.id === herParagraph.id)).toBe(herParagraph);
    expect(
      ReplaceGeneratedResult.parse({
        documentId: newId("document"),
        revision: 2,
        written: plan.written,
        removed: plan.removed,
        skipped: plan.skipped,
      }).skipped,
    ).toHaveLength(2);
  });

  it("regeneration within a scope keeps everything outside it", () => {
    const blocks = buildGuide();
    const incoming: BlockInput[] = [];
    const plan = planRegeneration(blocks, incoming, {
      actor: agent,
      now: t1,
      scope: [blocks[2]?.id as string],
    });
    expect(plan.removed).toEqual([blocks[2]?.id]);
    expect(plan.blocks).toHaveLength(5);
  });

  it("with her request, regeneration replaces her blocks too", () => {
    const blocks = buildGuide();
    const mine = editedByHer(blocks[1] as Block);
    const plan = planRegeneration([mine], [], {
      actor: agent,
      requestId: newId("request"),
    });
    expect(plan.removed).toEqual([mine.id]);
    expect(plan.skipped).toEqual([]);
  });
});

describe("writer operations", () => {
  it.each(Object.keys(WRITER_OPERATIONS) as Array<keyof typeof WRITER_OPERATIONS>)(
    "example for %s validates",
    (operation) => {
      const result = validateOperation(operation, OPERATION_EXAMPLES[operation]);
      if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
    },
  );

  it("never asks the writer for server fields", () => {
    for (const schema of Object.values(WRITER_OPERATIONS)) {
      const text = JSON.stringify(writerJsonSchema(schema));
      expect(text).not.toContain('"provenance"');
      expect(text).not.toContain('"lastEditedAt"');
      expect(text).not.toContain('"origin"');
    }
  });

  it("points block problems at the block inside the request, with a block example", () => {
    const result = validateOperation("insert_blocks", {
      documentId: newId("document"),
      blocks: [
        { type: "heading", content: { level: 1, text: "ok" } },
        { type: "paragraph", content: { text: "No source given." } },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.path).toBe("$.blocks[1].citations");
    expect(result.problems[0]?.message).toContain("generalKnowledge");
  });

  it("puts other problems on the body with an example of the operation", () => {
    const result = validateOperation("move_blocks", { documentId: "doc_x", blockIds: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.problems.map((problem) => problem.path);
    expect(paths).toContain("$.documentId");
    expect(paths).toContain("$.blockIds");
    expect(paths).toContain("$.position");
    expect(result.problems[0]?.example).toEqual(OPERATION_EXAMPLES.move_blocks);
  });

  it("checks a replace-mode block under $.block", () => {
    const result = validateOperation("update_block", {
      mode: "replace",
      documentId: newId("document"),
      blockId: newId("block"),
      block: { type: "callout", content: { kind: "hint", text: "x" }, generalKnowledge: true },
    });
    expect(!result.ok && result.problems.map((p) => p.path)).toEqual(["$.block.content.kind"]);
  });

  it("holds her blocks to structure but not to the citation rule", () => {
    const body = {
      documentId: newId("document"),
      blocks: [{ type: "paragraph", content: { text: "My own summary." } }],
    };
    expect(validateOperation("insert_blocks", body, { writer: "user" }).ok).toBe(true);
    expect(validateOperation("insert_blocks", body, { writer: "agent" }).ok).toBe(false);
  });

  it("creates a document in an existing node or a new one, not both", () => {
    const base = { kind: "study_guide", title: "Beta blockers" };
    expect(CreateDocumentInput.safeParse({ ...base, nodeId: newId("node") }).success).toBe(true);
    expect(CreateDocumentInput.safeParse({ ...base, parentId: newId("node") }).success).toBe(true);
    expect(CreateDocumentInput.safeParse(base).success).toBe(false);
    expect(
      CreateDocumentInput.safeParse({ ...base, nodeId: newId("node"), parentId: newId("node") })
        .success,
    ).toBe(false);
  });

  it("caps the number of blocks per call", () => {
    const result = validateOperation("insert_blocks", {
      documentId: newId("document"),
      blocks: Array(101).fill({ type: "divider" }),
    });
    expect(!result.ok && result.problems.map((p) => p.path)).toContain("$.blocks");
  });

  it("patches a block field by field and revalidates it", () => {
    const [, paragraph, , card] = buildGuide() as [Block, Block, Block, Block];
    const patched = applyBlockPatch(card, {
      content: { brandNames: ["Lopressor", "Toprol-XL"] },
      style: { color: "blue" },
    });
    expect(patched.ok).toBe(true);
    if (patched.ok && patched.block.type === "drug_card") {
      expect(patched.block.content.brandNames).toEqual(["Lopressor", "Toprol-XL"]);
      expect(patched.block.content.name).toBe("metoprolol tartrate");
      expect(patched.block.style).toEqual({ color: "blue" });
    }
    const broken = applyBlockPatch(paragraph, { citations: [] });
    // Dropping the citations orphans the paragraph's {cite: 1} marker and breaks the citation rule.
    expect(!broken.ok && broken.problems.map((p) => p.path)).toEqual([
      "$.content.text",
      "$.citations",
    ]);
    expect(
      UpdateBlockInput.safeParse({
        mode: "patch",
        documentId: newId("document"),
        blockId: card.id,
        patch: {},
      }).success,
    ).toBe(false);
  });
});

describe("positions", () => {
  const order = ["a", "b", "c"];
  it("resolves start, end, after, before and index", () => {
    expect(resolvePosition(order, "start")).toBe(0);
    expect(resolvePosition(order, "end")).toBe(3);
    expect(resolvePosition(order, { after: "a" })).toBe(1);
    expect(resolvePosition(order, { before: "a" })).toBe(0);
    expect(resolvePosition(order, { index: 99 })).toBe(3);
    expect(resolvePosition(order, { after: "zz" })).toBeNull();
  });

  it("inserts and moves", () => {
    expect(insertIds(order, ["x", "y"], { after: "b" })).toEqual(["a", "b", "x", "y", "c"]);
    expect(moveIds(order, ["c", "a"], "start")).toEqual(["c", "a", "b"]);
    expect(moveIds(order, ["a"], { after: "a" })).toBeNull();
    expect(moveIds(order, ["q"], "end")).toBeNull();
  });
});

describe("revisions (D12)", () => {
  it("restores a snapshot as a new revision", () => {
    const blocks = buildGuide();
    const doc = documentOf(blocks);
    const revision = Revision.parse({
      id: newId("revision"),
      documentId: doc.id,
      number: 1,
      author: agent,
      createdAt: t0,
      summary: "Created with 6 blocks",
      restoredFrom: null,
      snapshot: snapshotDocument(doc),
    });
    const later = { ...doc, title: "Renamed", blocks: [], blockIds: [], revision: 4 };
    const restored = restoreRevision(later, revision, { actor: hannah, now: t1 });
    expect(restored.revision).toBe(5);
    expect(restored.title).toBe("Beta blockers");
    expect(restored.blockIds).toEqual(doc.blockIds);
    expect(restored.lastEditedBy).toEqual(hannah);
    expect(DocumentWithBlocks.safeParse(restored).success).toBe(true);
    expect(RestoreRevisionInput.safeParse({ documentId: doc.id, revision: 1 }).success).toBe(true);
  });
});

describe("JSON Schema for writer inputs", () => {
  it.each(Object.entries(WRITER_OPERATIONS))("%s exports and stays small", (_name, schema) => {
    const json = writerJsonSchema(schema);
    const size = JSON.stringify(json).length;
    expect(size).toBeLessThan(40_000);
    expect(json.$schema).toContain("json-schema.org");
  });

  it("names the shared definitions", () => {
    const text = JSON.stringify(writerJsonSchema(WRITER_OPERATIONS.insert_blocks));
    for (const name of ["Citation", "Inline", "ColorToken", "block_drug_card", "block_mind_map"]) {
      expect(text).toContain(`"#/$defs/${name}"`);
    }
  });
});
