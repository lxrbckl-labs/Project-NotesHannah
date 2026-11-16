import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BLOCK_LIMITS,
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  Block,
  BlockInput,
  type BlockInputRaw,
  blockConceptMentions,
  blockPlainText,
  ColorToken,
  normalizeRichText,
  richText,
  stampNewBlock,
  validateBlockInput,
} from "../src/blocks/index.js";
import type { Actor } from "../src/common.js";
import { newId } from "../src/ids.js";

const agent: Actor = { type: "agent", keyId: newId("apiKey"), label: "Claude Code" };
const now = "2026-11-15T18:20:00.000Z";

const fileId = newId("file");
const pageId = newId("page");
const conceptId = newId("concept");
const citation = {
  fileId,
  pageId,
  quote: "Metoprolol: start 25 mg PO BID, titrate to HR 55–60.",
  label: "Slide 14",
};

function valid(raw: unknown, writer: "agent" | "user" = "agent") {
  const result = validateBlockInput(raw, { writer });
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
  return result.block;
}

function problems(raw: unknown, writer: "agent" | "user" = "agent") {
  const result = validateBlockInput(raw, { writer });
  if (result.ok) throw new Error(`Expected problems for ${JSON.stringify(raw)}`);
  return result.problems;
}

/** One realistic, fuller block per type, beyond the minimal registry examples. */
const FULL: Record<(typeof BLOCK_TYPES)[number], BlockInputRaw> = {
  heading: { type: "heading", content: { level: 1, text: "Lecture 7 · Beta blockers" } },
  paragraph: {
    type: "paragraph",
    content: {
      text: [
        { text: "Beta blockers", bold: true },
        { text: " lower heart rate and contractility. " },
        { concept: conceptId, text: "Metoprolol" },
        { text: " is β1-selective at low doses.", highlight: "yellow" },
        { cite: 1 },
      ],
    },
    citations: [citation],
  },
  bulleted_list: {
    type: "bulleted_list",
    content: {
      items: ["Bradycardia", { text: "Heart block", indent: 1 }, "Bronchospasm (non-selective)"],
    },
    citations: [citation],
  },
  numbered_list: {
    type: "numbered_list",
    content: { items: ["Hold if HR < 50", "Recheck BP in 1 hour"], start: 3 },
    citations: [citation],
  },
  checklist: {
    type: "checklist",
    content: { items: ["Make flashcards for -olol drugs", { text: "Read ch. 12", checked: true }] },
  },
  quote: {
    type: "quote",
    content: {
      text: "Taper over 1–2 weeks to avoid rebound tachycardia.",
      attribution: "Dr Patel",
    },
    citations: [citation],
  },
  divider: { type: "divider", content: {} },
  table: {
    type: "table",
    content: {
      rows: [
        ["Drug", "Usual start"],
        ["Metoprolol tartrate", "25 mg BID"],
        ["Atenolol", ""],
      ],
      headerColumn: true,
      caption: "Starting doses from lecture 7",
    },
    citations: [citation],
    flags: [{ kind: "dose", quote: "25 mg BID", note: "Check against the slide" }],
  },
  image: {
    type: "image",
    content: {
      source: { fileId, pageId, region: { x: 0, y: 0.5, width: 1, height: 0.5 } },
      alt: "Hand-drawn receptor diagram",
      caption: "From her notes",
    },
  },
  callout: {
    type: "callout",
    content: { kind: "warning", title: "Abrupt withdrawal", text: "Can precipitate angina." },
    style: { color: "red", background: "red" },
    citations: [citation],
  },
  drug_card: {
    type: "drug_card",
    content: {
      name: "metoprolol tartrate",
      concept: conceptId,
      brandNames: ["Lopressor"],
      drugClass: "β1-selective adrenergic antagonist",
      mechanism: { text: "Competitively blocks β1 receptors in the heart.", citations: [citation] },
      indications: ["Hypertension", "Angina", "Post-MI"],
      adverseEffects: ["Bradycardia", "Fatigue", "Dizziness"],
      contraindications: ["Severe bradycardia", "Decompensated heart failure"],
      interactions: ["Verapamil and diltiazem: additive AV block"],
      monitoring: ["Heart rate", "Blood pressure"],
      counselling: ["Do not stop suddenly"],
      dosingNotes: [
        {
          text: [{ text: "Start 25 mg PO BID" }, { cite: 1 }],
          citations: [citation],
          flags: [{ kind: "dose", quote: "25 mg" }],
        },
      ],
    },
  },
  comparison_table: {
    type: "comparison_table",
    content: {
      title: "Cardioselective or not",
      attributes: ["β1 selective", "ISA"],
      rows: [
        { subject: "Metoprolol", concept: conceptId, cells: ["Yes", "No"] },
        { subject: "Pindolol", cells: ["No", { text: "Yes", citations: [citation] }] },
      ],
    },
    citations: [citation],
  },
  mnemonic: {
    type: "mnemonic",
    content: {
      device: "A to M",
      topic: "β1-selective agents",
      parts: [
        { key: "A", meaning: "Acebutolol, Atenolol" },
        { key: "B", meaning: "Betaxolol, Bisoprolol" },
        { key: "E", meaning: "Esmolol" },
        { key: "M", meaning: "Metoprolol" },
      ],
      note: "Letters A to M, except labetalol",
    },
    generalKnowledge: true,
  },
  labelled_image: {
    type: "labelled_image",
    content: {
      image: { fileId },
      alt: "Cardiac conduction system",
      hotspots: [
        { x: 0.3, y: 0.2, label: "SA node", detail: "Rate slowed by β blockade" },
        { x: 0.5, y: 0.45, label: "AV node", concept: conceptId },
      ],
    },
    citations: [citation],
  },
  mind_map: {
    type: "mind_map",
    content: {
      root: {
        label: "Beta blockers",
        color: "blue",
        children: [{ label: "Uses", children: [{ label: "Hypertension" }] }, { label: "Cautions" }],
      },
    },
    citations: [citation],
  },
  question: { type: "question", content: { questionId: newId("question") } },
};

describe("block registry", () => {
  it("covers every block type with a label, description and example", () => {
    for (const type of BLOCK_TYPES) {
      const entry = BLOCK_REGISTRY[type];
      expect(entry.type).toBe(type);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.example.type).toBe(type);
      expect(typeof entry.citationsRequired).toBe("boolean");
    }
    expect(BLOCK_TYPES).toHaveLength(16);
  });

  it.each(BLOCK_TYPES)("registry example for %s is a valid agent block", (type) => {
    const block = valid(BLOCK_REGISTRY[type].example);
    expect(block.type).toBe(type);
    expect(BlockInput.safeParse(BLOCK_REGISTRY[type].example).success).toBe(true);
  });

  it.each(BLOCK_TYPES)("full %s parses, round-trips and stamps into a stored block", (type) => {
    const block = valid(FULL[type]);
    // Normalised output parses again to the same thing.
    expect(valid(block)).toEqual(block);
    // Survives JSON.
    expect(valid(JSON.parse(JSON.stringify(block)))).toEqual(block);
    const stored = stampNewBlock(block, { actor: agent, now });
    expect(Block.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(stored.origin).toBe("agent");
    expect(stored.review.status).toBe("unverified");
    expect(BLOCK_REGISTRY[type].schema.safeParse(stored).success).toBe(true);
  });
});

describe("rich text", () => {
  it("normalises the plain string shorthand into runs", () => {
    const block = valid({
      type: "heading",
      content: { level: 2, text: "Class II antiarrhythmics" },
    });
    expect(block.content).toEqual({ level: 2, text: [{ text: "Class II antiarrhythmics" }] });
  });

  it("normalises shorthand everywhere rich text is accepted", () => {
    const list = valid(FULL.bulleted_list);
    expect(list.type === "bulleted_list" && list.content.items[0]).toEqual({
      text: [{ text: "Bradycardia" }],
      indent: 0,
    });
    const card = valid(FULL.drug_card);
    expect(card.type === "drug_card" && card.content.drugClass).toEqual({
      text: [{ text: "β1-selective adrenergic antagonist" }],
      citations: [],
      flags: [],
    });
  });

  it("merges neighbouring runs with the same marks and drops false marks", () => {
    expect(
      normalizeRichText([
        { text: "Pro", bold: true },
        { text: "pranolol", bold: true, italic: false },
        { cite: 1 },
        { text: "x" },
      ]),
    ).toEqual([{ text: "Propranolol", bold: true }, { cite: 1 }, { text: "x" }]);
    expect(normalizeRichText("")).toEqual([]);
  });

  it("rejects raw colours with a message about tokens", () => {
    const result = ColorToken.safeParse("#ff0000");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("colour token");
    const found = problems({
      type: "paragraph",
      content: { text: [{ text: "x", highlight: "#ffff00" }] },
      generalKnowledge: true,
    });
    expect(found[0]?.path).toBe("$.content.text[0].highlight");
    expect(found[0]?.message).toContain("colour token");
  });

  it("explains a bad inline item by its most likely shape", () => {
    const found = problems({
      type: "paragraph",
      content: { text: [{ text: "Atenolol", bold: "yes" }] },
      generalKnowledge: true,
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("$.content.text[0].bold");
    expect(found[0]?.message).toContain("boolean");
  });

  it("only allows http(s) links", () => {
    expect(
      problems({
        type: "paragraph",
        content: { text: [{ text: "x", link: "javascript:alert(1)" }] },
        generalKnowledge: true,
      })[0]?.message,
    ).toContain("http");
  });

  it("enforces the character limit on normalised text", () => {
    const schema = richText(10);
    expect(schema.safeParse("0123456789").success).toBe(true);
    expect(schema.safeParse([{ text: "01234" }, { text: "567890", bold: true }]).success).toBe(
      false,
    );
  });
});

const long = (n: number) => "x".repeat(n);
const gk = { generalKnowledge: true };

/** [name, block, expected path of the first problem]. */
const LIMIT_CASES: Array<[string, unknown, string]> = [
  ["heading level", { type: "heading", content: { level: 4, text: "x" } }, "$.content.level"],
  [
    "heading length",
    { type: "heading", content: { level: 1, text: long(BLOCK_LIMITS.headingChars + 1) } },
    "$.content.text",
  ],
  [
    "paragraph length",
    { type: "paragraph", content: { text: long(BLOCK_LIMITS.paragraphChars + 1) }, ...gk },
    "$.content.text",
  ],
  ["empty list", { type: "bulleted_list", content: { items: [] }, ...gk }, "$.content.items"],
  [
    "list size",
    {
      type: "bulleted_list",
      content: { items: Array(BLOCK_LIMITS.listItems + 1).fill("x") },
      ...gk,
    },
    "$.content.items",
  ],
  [
    "list indent jump",
    { type: "numbered_list", content: { items: ["a", { text: "b", indent: 2 }] }, ...gk },
    "$.content.items",
  ],
  [
    "list max indent",
    {
      type: "bulleted_list",
      content: {
        items: ["a", { text: "b", indent: 1 }, { text: "c", indent: 2 }, { text: "d", indent: 3 }],
      },
      ...gk,
    },
    "$.content.items[3].indent",
  ],
  [
    "checklist size",
    { type: "checklist", content: { items: Array(BLOCK_LIMITS.listItems + 1).fill("x") } },
    "$.content.items",
  ],
  [
    "quote length",
    { type: "quote", content: { text: long(BLOCK_LIMITS.quoteChars + 1) }, ...gk },
    "$.content.text",
  ],
  [
    "table rows",
    {
      type: "table",
      content: { rows: Array(BLOCK_LIMITS.tableRows + 1).fill(["a"]) },
      ...gk,
    },
    "$.content.rows",
  ],
  [
    "table columns",
    {
      type: "table",
      content: { rows: [Array(BLOCK_LIMITS.tableColumns + 1).fill("a")] },
      ...gk,
    },
    "$.content.rows[0]",
  ],
  [
    "ragged table",
    { type: "table", content: { rows: [["a", "b"], ["c"]] }, ...gk },
    "$.content.rows",
  ],
  [
    "table cell length",
    { type: "table", content: { rows: [[long(BLOCK_LIMITS.tableCellChars + 1)]] }, ...gk },
    "$.content.rows[0][0]",
  ],
  [
    "image alt required",
    { type: "image", content: { source: { fileId }, alt: "  " } },
    "$.content.alt",
  ],
  [
    "image region off the page",
    {
      type: "image",
      content: { source: { fileId, region: { x: 0.6, y: 0, width: 0.5, height: 1 } }, alt: "a" },
    },
    "$.content.source.region",
  ],
  [
    "callout kind",
    { type: "callout", content: { kind: "note", text: "x" }, ...gk },
    "$.content.kind",
  ],
  [
    "callout title length",
    {
      type: "callout",
      content: { kind: "tip", title: long(BLOCK_LIMITS.calloutTitleChars + 1), text: "x" },
      ...gk,
    },
    "$.content.title",
  ],
  ["drug name required", { type: "drug_card", content: { name: "" }, ...gk }, "$.content.name"],
  [
    "brand names",
    {
      type: "drug_card",
      content: { name: "x", brandNames: Array(BLOCK_LIMITS.brandNames + 1).fill("B") },
      ...gk,
    },
    "$.content.brandNames",
  ],
  [
    "drug list size",
    {
      type: "drug_card",
      content: { name: "x", adverseEffects: Array(BLOCK_LIMITS.drugListEntries + 1).fill("y") },
      ...gk,
    },
    "$.content.adverseEffects",
  ],
  [
    "field citations",
    {
      type: "drug_card",
      content: {
        name: "x",
        dosingNotes: [{ text: "5 mg", citations: Array(6).fill(citation) }],
      },
    },
    "$.content.dosingNotes[0].citations",
  ],
  [
    "comparison rows",
    {
      type: "comparison_table",
      content: { attributes: ["a"], rows: [{ subject: "x", cells: ["1"] }] },
      ...gk,
    },
    "$.content.rows",
  ],
  [
    "comparison columns",
    {
      type: "comparison_table",
      content: {
        attributes: Array(BLOCK_LIMITS.comparisonColumns + 1).fill("a"),
        rows: [
          { subject: "x", cells: [] },
          { subject: "y", cells: [] },
        ],
      },
      ...gk,
    },
    "$.content.attributes",
  ],
  [
    "comparison cell count",
    {
      type: "comparison_table",
      content: {
        attributes: ["a", "b"],
        rows: [
          { subject: "x", cells: ["1", "2"] },
          { subject: "y", cells: ["1"] },
        ],
      },
      ...gk,
    },
    "$.content.rows[1].cells",
  ],
  [
    "mnemonic parts",
    {
      type: "mnemonic",
      content: {
        device: "x",
        parts: Array(BLOCK_LIMITS.mnemonicParts + 1).fill({ key: "a", meaning: "b" }),
      },
      ...gk,
    },
    "$.content.parts",
  ],
  [
    "mnemonic needs parts",
    { type: "mnemonic", content: { device: "x", parts: [] }, ...gk },
    "$.content.parts",
  ],
  [
    "hotspot coordinates",
    {
      type: "labelled_image",
      content: { image: { fileId }, alt: "a", hotspots: [{ x: 1.2, y: 0.5, label: "z" }] },
      ...gk,
    },
    "$.content.hotspots[0].x",
  ],
  [
    "hotspot count",
    {
      type: "labelled_image",
      content: {
        image: { fileId },
        alt: "a",
        hotspots: Array(BLOCK_LIMITS.hotspots + 1).fill({ x: 0.5, y: 0.5, label: "z" }),
      },
      ...gk,
    },
    "$.content.hotspots",
  ],
  [
    "mind map depth",
    {
      type: "mind_map",
      content: {
        root: {
          label: "0",
          children: [
            {
              label: "1",
              children: [
                {
                  label: "2",
                  children: [
                    { label: "3", children: [{ label: "4", children: [{ label: "5" }] }] },
                  ],
                },
              ],
            },
          ],
        },
      },
      ...gk,
    },
    "$.content.root.children[0].children[0].children[0].children[0].children[0]",
  ],
  [
    "mind map children",
    {
      type: "mind_map",
      content: {
        root: {
          label: "r",
          children: Array(BLOCK_LIMITS.mindMapChildren + 1).fill({ label: "c" }),
        },
      },
      ...gk,
    },
    "$.content.root.children",
  ],
  [
    "mind map nodes",
    {
      type: "mind_map",
      content: {
        root: {
          label: "r",
          children: Array(10).fill({ label: "c", children: Array(10).fill({ label: "l" }) }),
        },
      },
      ...gk,
    },
    "$.content.root",
  ],
  [
    "question id kind",
    { type: "question", content: { questionId: newId("concept") } },
    "$.content.questionId",
  ],
  [
    "block citations",
    { type: "paragraph", content: { text: "x" }, citations: Array(21).fill(citation) },
    "$.citations",
  ],
  [
    "quote length in a citation",
    { type: "paragraph", content: { text: "x" }, citations: [{ ...citation, quote: long(1001) }] },
    "$.citations[0].quote",
  ],
  [
    "flag count",
    {
      type: "paragraph",
      content: { text: "x" },
      flags: Array(21).fill({ kind: "dose" }),
      ...gk,
    },
    "$.flags",
  ],
  [
    "citation marker out of range",
    { type: "paragraph", content: { text: [{ text: "x" }, { cite: 2 }] }, citations: [citation] },
    "$.content.text",
  ],
];

describe("limits", () => {
  it.each(LIMIT_CASES)("%s", (_name, raw, path) => {
    const found = problems(raw);
    expect(found.map((problem) => problem.path)).toContain(path);
  });

  it("accepts the largest allowed sizes", () => {
    valid({ type: "heading", content: { level: 3, text: long(BLOCK_LIMITS.headingChars) } });
    valid({
      type: "table",
      content: {
        rows: Array(BLOCK_LIMITS.tableRows).fill(Array(BLOCK_LIMITS.tableColumns).fill("a")),
      },
      ...gk,
    });
    valid({
      type: "mind_map",
      content: {
        root: {
          label: "0",
          children: [
            {
              label: "1",
              children: [{ label: "2", children: [{ label: "3", children: [{ label: "4" }] }] }],
            },
          ],
        },
      },
      ...gk,
    });
  });
});

describe("validation errors", () => {
  it("lists the valid types for an unknown type", () => {
    const [problem] = problems({ type: "flashcard", content: {} });
    expect(problem?.path).toBe("$.type");
    for (const type of BLOCK_TYPES) expect(problem?.message).toContain(type);
    expect(problem?.example).toEqual(BLOCK_REGISTRY.paragraph.example);
  });

  it("suggests the closest type for a near miss", () => {
    const [problem] = problems({ type: "Drug-Card", content: {} });
    expect(problem?.message).toContain('Did you mean "drug_card"?');
    expect(problem?.example).toEqual(BLOCK_REGISTRY.drug_card.example);
  });

  it("says what a block is when given something else", () => {
    const [problem] = problems("a paragraph");
    expect(problem?.path).toBe("$");
    expect(problem?.message).toContain('"type"');
  });

  it("gives every problem a path, a message and an example of the same type", () => {
    const found = problems({
      type: "callout",
      content: { kind: "tip", text: 7, extra: true },
      citations: [{ fileId, pageId }],
    });
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const problem of found) {
      expect(problem.path).toMatch(/^\$/);
      expect(problem.message.length).toBeGreaterThan(5);
      expect(problem.example).toEqual(BLOCK_REGISTRY.callout.example);
    }
    const paths = found.map((problem) => problem.path);
    expect(paths).toContain("$.content.text");
    expect(paths).toContain("$.content.extra");
    expect(paths).toContain("$.citations[0].quote");
  });

  it("names missing fields", () => {
    const found = problems({ type: "paragraph", content: {}, ...gk });
    expect(found[0]).toMatchObject({ path: "$.content.text" });
    expect(found[0]?.message).toContain('Missing required field "text"');
  });

  it("explains server-assigned fields instead of accepting them", () => {
    const found = problems({
      ...BLOCK_REGISTRY.heading.example,
      id: newId("block"),
      origin: "user",
    });
    expect(found.map((problem) => problem.path)).toEqual(["$.id", "$.origin"]);
    expect(found[0]?.message).toContain("assigned by the server");
  });

  it("prefixes paths when the block sits inside a request", () => {
    const result = validateBlockInput({ type: "nope" }, { pathPrefix: "$.blocks[2]" });
    expect(!result.ok && result.problems[0]?.path).toBe("$.blocks[2].type");
  });

  it("allows a field-level citation marker to point into the field's own list", () => {
    valid(FULL.drug_card);
    const found = problems({
      type: "drug_card",
      content: {
        name: "x",
        dosingNotes: [{ text: [{ text: "5 mg" }, { cite: 2 }], citations: [citation] }],
      },
    });
    expect(found[0]?.path).toBe("$.content.dosingNotes[0]");
    expect(found[0]?.message).toContain("this field's citations");
  });

  it("refuses generalKnowledge together with citations", () => {
    const found = problems({ ...BLOCK_REGISTRY.paragraph.example, generalKnowledge: true });
    expect(found[0]?.path).toBe("$.generalKnowledge");
    const field = problems({
      type: "drug_card",
      content: {
        name: "x",
        mechanism: { text: "y", citations: [citation], generalKnowledge: true },
      },
    });
    expect(field[0]?.path).toBe("$.content.mechanism");
  });
});

describe("plain text", () => {
  const expected: Record<(typeof BLOCK_TYPES)[number], string[]> = {
    heading: ["Lecture 7 · Beta blockers"],
    paragraph: [
      "Beta blockers lower heart rate and contractility. Metoprolol is β1-selective at low doses.",
    ],
    bulleted_list: ["Bradycardia\nHeart block\nBronchospasm (non-selective)"],
    numbered_list: ["Hold if HR < 50\nRecheck BP in 1 hour"],
    checklist: ["Make flashcards for -olol drugs\nRead ch. 12"],
    quote: ["Taper over 1–2 weeks to avoid rebound tachycardia.\nDr Patel"],
    divider: [""],
    table: ["Drug\nUsual start\nMetoprolol tartrate\n25 mg BID\nAtenolol\nStarting doses"],
    image: ["Hand-drawn receptor diagram\nFrom her notes"],
    callout: ["Abrupt withdrawal\nCan precipitate angina."],
    drug_card: ["metoprolol tartrate\nLopressor\nβ1-selective", "Start 25 mg PO BID"],
    comparison_table: ["Cardioselective or not\nβ1 selective\nISA\nMetoprolol\nYes\nNo\nPindolol"],
    mnemonic: ["A to M\nβ1-selective agents\nA\nAcebutolol, Atenolol", "except labetalol"],
    labelled_image: ["Cardiac conduction system\nSA node\nRate slowed by β blockade\nAV node"],
    mind_map: ["Beta blockers\nUses\nHypertension\nCautions"],
    question: [""],
  };

  it.each(BLOCK_TYPES)("extracts readable text from %s", (type) => {
    const text = blockPlainText(valid(FULL[type]));
    for (const piece of expected[type]) expect(text).toContain(piece);
    expect(text).not.toContain("cite");
    if (expected[type][0] === "") expect(text).toBe("");
  });
});

describe("concept mentions", () => {
  it("finds inline mentions and concept-bearing fields", () => {
    expect(blockConceptMentions(valid(FULL.paragraph))).toEqual([
      { conceptId, text: "Metoprolol", path: ["content", "text"] },
    ]);
    expect(blockConceptMentions(valid(FULL.drug_card))[0]).toMatchObject({
      conceptId,
      text: "metoprolol tartrate",
    });
    expect(blockConceptMentions(valid(FULL.comparison_table))).toHaveLength(1);
    expect(blockConceptMentions(valid(FULL.labelled_image))[0]?.text).toBe("AV node");
  });
});

describe("JSON Schema", () => {
  it("exports the writer block input with recursion and defs", () => {
    const schema = z.toJSONSchema(BlockInput, { io: "input", reused: "ref" });
    const text = JSON.stringify(schema);
    expect(text.length).toBeLessThan(60_000);
    for (const type of BLOCK_TYPES) expect(text).toContain(`"${type}"`);
  });

  it.each(BLOCK_TYPES)("exports %s on its own", (type) => {
    expect(() =>
      z.toJSONSchema(BLOCK_REGISTRY[type].inputSchema, { io: "input", reused: "ref" }),
    ).not.toThrow();
  });
});
