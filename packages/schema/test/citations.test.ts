import { describe, expect, it } from "vitest";
import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  CITATION_EXEMPT_TYPES,
  citationRuleIssue,
  countCitations,
  validateBlockInput,
} from "../src/blocks/index.js";
import {
  Citation,
  CitationBacklink,
  citationKey,
  findQuote,
  NormalizedBox,
  PageBacklinks,
  ResolvedCitation,
} from "../src/citations.js";
import { newId } from "../src/ids.js";

const fileId = newId("file");
const pageId = newId("page");
const transcript =
  "Beta blockers\n• Cardioselective (β1): atenolol, metoprolol, bisoprolol\n• Avoid abrupt withdrawal → rebound tachycardia";
const citation = {
  fileId,
  pageId,
  quote: "Avoid abrupt withdrawal → rebound tachycardia",
  transcriptId: newId("transcript"),
  transcriptRevision: 2,
  region: { x: 0.08, y: 0.62, width: 0.8, height: 0.1 },
  label: "Slide 9",
};

describe("citation shape", () => {
  it("accepts a full citation and a minimal one", () => {
    expect(Citation.parse(citation)).toEqual(citation);
    expect(Citation.safeParse({ fileId, pageId, quote: "atenolol" }).success).toBe(true);
  });

  it("requires a quote, within the length limit", () => {
    expect(Citation.safeParse({ fileId, pageId, quote: "" }).success).toBe(false);
    const tooLong = Citation.safeParse({ fileId, pageId, quote: "x".repeat(1001) });
    expect(!tooLong.success && tooLong.error.issues[0]?.message).toContain("supporting sentence");
  });

  it("checks the ID kinds", () => {
    expect(Citation.safeParse({ ...citation, fileId: pageId }).success).toBe(false);
    expect(Citation.safeParse({ ...citation, pageId: fileId }).success).toBe(false);
  });

  it("needs transcriptId whenever transcriptRevision is given", () => {
    const { transcriptId: _, ...rest } = citation;
    const result = Citation.safeParse(rest);
    expect(!result.success && result.error.issues[0]?.path).toEqual(["transcriptRevision"]);
  });

  it("keeps regions on the page, in fractions", () => {
    expect(NormalizedBox.safeParse({ x: 0, y: 0, width: 1, height: 1 }).success).toBe(true);
    expect(NormalizedBox.safeParse({ x: 0.5, y: 0, width: 0.6, height: 0.1 }).success).toBe(false);
    expect(NormalizedBox.safeParse({ x: 0, y: 0, width: 0, height: 0.1 }).success).toBe(false);
    expect(NormalizedBox.safeParse({ x: -0.1, y: 0, width: 0.5, height: 0.1 }).success).toBe(false);
    expect(NormalizedBox.safeParse({ x: 0, y: 0, width: 120, height: 40 }).success).toBe(false);
  });

  it("rejects unknown keys so typos are caught", () => {
    expect(Citation.safeParse({ ...citation, page: 3 }).success).toBe(false);
  });
});

describe("quotes and identity", () => {
  it("finds exact quotes and only exact quotes", () => {
    expect(findQuote(transcript, citation.quote)).toBeGreaterThan(0);
    expect(findQuote(transcript, "avoid abrupt withdrawal")).toBe(-1);
    expect(findQuote(transcript, "")).toBe(-1);
  });

  it("treats the same passage on the same page as one reference", () => {
    expect(citationKey(citation)).toBe(
      citationKey({ ...citation, label: "other", region: undefined }),
    );
    expect(citationKey(citation)).not.toBe(citationKey({ ...citation, quote: "atenolol" }));
  });
});

describe("the citation rule", () => {
  const paragraph = { type: "paragraph", content: { text: "Taper beta blockers over 1–2 weeks." } };

  it("refuses an agent block without a citation, explaining the rule with an example", () => {
    const result = validateBlockInput(paragraph, { writer: "agent" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [problem] = result.problems;
    expect(problem?.path).toBe("$.citations");
    expect(problem?.message).toContain("must say where they came from");
    expect(problem?.message).toContain('"generalKnowledge": true');
    expect(problem?.message).toContain("not from your notes");
    expect(problem?.message).toContain('"quote"');
    expect(problem?.example).toEqual(BLOCK_REGISTRY.paragraph.example);
    // The example it offers passes the rule.
    expect(validateBlockInput(problem?.example, { writer: "agent" }).ok).toBe(true);
  });

  it("treats agent as the default writer", () => {
    expect(validateBlockInput(paragraph).ok).toBe(false);
  });

  it("accepts the block when it is marked general knowledge", () => {
    expect(validateBlockInput({ ...paragraph, generalKnowledge: true }).ok).toBe(true);
  });

  it("accepts the block with a citation", () => {
    expect(validateBlockInput({ ...paragraph, citations: [citation] }).ok).toBe(true);
  });

  it("counts field-level citations", () => {
    const card = {
      type: "drug_card",
      content: { name: "atenolol", dosingNotes: [{ text: "50 mg daily", citations: [citation] }] },
    };
    const result = validateBlockInput(card);
    expect(result.ok).toBe(true);
    if (result.ok) expect(countCitations(result.block)).toBe(1);
  });

  it("exempts blocks she writes", () => {
    expect(validateBlockInput(paragraph, { writer: "user" }).ok).toBe(true);
    expect(
      validateBlockInput(paragraph, { writer: { type: "user", userId: newId("user") } }).ok,
    ).toBe(true);
  });

  it("exempts headings and other structural types", () => {
    expect(
      validateBlockInput({ type: "heading", content: { level: 1, text: "Beta blockers" } }).ok,
    ).toBe(true);
    expect(validateBlockInput({ type: "divider" }).ok).toBe(true);
    expect(CITATION_EXEMPT_TYPES).toEqual(["heading", "checklist", "divider", "image", "question"]);
  });

  it("applies to every content-bearing type", () => {
    for (const type of BLOCK_TYPES) {
      if (CITATION_EXEMPT_TYPES.includes(type)) continue;
      const { citations: _c, generalKnowledge: _g, ...bare } = BLOCK_REGISTRY[type].example;
      const result = validateBlockInput(bare);
      expect(result.ok, type).toBe(false);
      if (!result.ok) expect(result.problems.at(-1)?.path).toBe("$.citations");
    }
  });

  it("is also available as a plain function on normalized blocks", () => {
    const result = validateBlockInput({ ...paragraph, generalKnowledge: true });
    if (!result.ok) throw new Error("unexpected");
    const block = { ...result.block, generalKnowledge: false };
    expect(citationRuleIssue(block, "agent")?.path).toEqual(["citations"]);
    expect(citationRuleIssue(block, "user")).toBeNull();
  });
});

describe("unavailable sources and the reverse view", () => {
  it("resolves a citation whose file was trashed without losing it", () => {
    const resolved = ResolvedCitation.parse({
      citation,
      number: 3,
      status: "source_trashed",
      fileName: "Lecture 7 - Beta blockers.pdf",
      pageIndex: 9,
    });
    expect(resolved.citation.quote).toBe(citation.quote);
    const deleted = ResolvedCitation.parse({
      citation,
      number: 3,
      status: "source_deleted",
      fileName: null,
      pageIndex: null,
    });
    expect(deleted.status).toBe("source_deleted");
  });

  it("describes what cites a page, blocks and questions alike", () => {
    const backlinks = PageBacklinks.parse({
      pageId,
      fileId,
      items: [
        {
          location: {
            kind: "block",
            documentId: newId("document"),
            blockId: newId("block"),
            field: "$.content.dosingNotes[0]",
          },
          title: "Beta blockers study guide",
          nodeId: newId("node"),
          itemType: "drug_card",
          quote: citation.quote,
          region: citation.region,
          trashed: false,
        },
        {
          location: { kind: "question", questionId: newId("question") },
          title: "Which beta blocker is cardioselective?",
          nodeId: null,
          itemType: "question",
          quote: "atenolol",
          trashed: false,
        },
      ],
    });
    expect(backlinks.items).toHaveLength(2);
    expect(
      CitationBacklink.safeParse({ ...backlinks.items[0], location: { kind: "page" } }).success,
    ).toBe(false);
  });
});
