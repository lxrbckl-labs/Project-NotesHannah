import { z } from "zod";
import { CITATION_LIMITS, type Citation, citationList } from "../citations.js";
import { BlockId } from "../ids.js";
import {
  BlockFlag,
  BlockReview,
  type CitedText,
  FLAG_LIMITS,
  Origin,
  Provenance,
} from "./common.js";
import { citationMarkers, normalizeRichText, type RichText } from "./rich-text.js";
import { BlockStyle } from "./tokens.js";
import {
  BulletedListContent,
  CalloutContent,
  ChecklistContent,
  ComparisonTableContent,
  DividerContent,
  DrugCardContent,
  HeadingContent,
  ImageContent,
  LabelledImageContent,
  MindMapContent,
  MnemonicContent,
  NumberedListContent,
  ParagraphContent,
  QuestionContent,
  QuoteContent,
  TableContent,
  walkMindMap,
} from "./types.js";

/**
 * The block registry: one entry per block type. The block unions, the
 * writer input schemas, validation, plain-text extraction and the agent
 * overview are all derived from it, so adding a block type is one entry
 * here (plus its content schema in types.ts).
 */

/** A path inside a block, e.g. ["content", "items", 2, "text"]. */
export type BlockPath = (string | number)[];

/**
 * A piece of readable text inside a block's content, in reading order.
 * Used for plain-text extraction, concept mentions, field citations and
 * citation-marker checks.
 */
export interface ContentPart {
  path: BlockPath;
  text: RichText;
  /** Set when the part is a citable field with its own citations and flags. */
  field?: CitedText;
  /** A concept the part names, such as a comparison row's drug. */
  concept?: string | undefined;
}

/** A writer's block as an agent would send it. Shown in docs and errors. */
export interface BlockExample {
  type: string;
  content?: unknown;
  citations?: unknown[];
  generalKnowledge?: boolean;
  style?: unknown;
  flags?: unknown[];
}

export interface BlockDefinition<C extends z.ZodType> {
  /** Name shown to her in the block menu. */
  label: string;
  /** What the block is for and when to use it, written for agents. */
  description: string;
  /** Whether a generated block of this type must cite a source or be marked general knowledge. */
  citationsRequired: boolean;
  content: C;
  /** A minimal valid writer input. */
  example: BlockExample;
  /** Readable parts of the content, in reading order. */
  parts: (content: z.output<C>) => ContentPart[];
}

function defineBlock<C extends z.ZodType>(definition: BlockDefinition<C>): BlockDefinition<C> {
  return definition;
}

const plain = (path: BlockPath, value: string | undefined, concept?: string): ContentPart[] =>
  value === undefined || value === "" ? [] : [{ path, text: normalizeRichText(value), concept }];

const rich = (path: BlockPath, value: RichText | undefined): ContentPart[] =>
  value === undefined || value.length === 0 ? [] : [{ path, text: value }];

const cited = (path: BlockPath, value: CitedText | undefined): ContentPart[] =>
  value === undefined ? [] : [{ path, text: value.text, field: value }];

const citedLists = (path: BlockPath, values: CitedText[]): ContentPart[] =>
  values.flatMap((value, i) => cited([...path, i], value));

/** Example IDs used in examples and docs. Well-formed but not real. */
export const EXAMPLE_IDS = {
  file: "fil_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  page: "pag_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  transcript: "trn_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  concept: "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  question: "qst_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  block: "blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  document: "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  node: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
} as const;

/** An example citation, as an agent writes one. */
export const EXAMPLE_CITATION = {
  fileId: EXAMPLE_IDS.file,
  pageId: EXAMPLE_IDS.page,
  quote: "Cardioselective agents (atenolol, metoprolol) preferentially block β1 receptors.",
  label: "Slide 12",
};

const cite = [EXAMPLE_CITATION];

const DEFINITIONS = {
  heading: defineBlock({
    label: "Heading",
    description: "A section title, level 1 to 3. Structural, so it needs no citation.",
    citationsRequired: false,
    content: HeadingContent,
    example: { type: "heading", content: { level: 2, text: "Beta-adrenergic antagonists" } },
    parts: (c) => rich(["content", "text"], c.text),
  }),
  paragraph: defineBlock({
    label: "Paragraph",
    description:
      "Running text. Use rich text runs for emphasis and {cite: n} markers after claims.",
    citationsRequired: true,
    content: ParagraphContent,
    example: {
      type: "paragraph",
      content: { text: "Atenolol and metoprolol are cardioselective (β1) blockers." },
      citations: cite,
    },
    parts: (c) => rich(["content", "text"], c.text),
  }),
  bulleted_list: defineBlock({
    label: "Bulleted list",
    description:
      "Unordered points. Items are strings or {text, indent}; indent 0 to 2 nests under the item before.",
    citationsRequired: true,
    content: BulletedListContent,
    example: {
      type: "bulleted_list",
      content: { items: ["Bradycardia", "Fatigue", { text: "Masks hypoglycaemia", indent: 1 }] },
      citations: cite,
    },
    parts: (c) => c.items.flatMap((item, i) => rich(["content", "items", i, "text"], item.text)),
  }),
  numbered_list: defineBlock({
    label: "Numbered list",
    description: "Ordered steps or ranked points. Same items as a bulleted list, plus `start`.",
    citationsRequired: true,
    content: NumberedListContent,
    example: {
      type: "numbered_list",
      content: { items: ["Check heart rate", "Check blood pressure", "Ask about dizziness"] },
      citations: cite,
    },
    parts: (c) => c.items.flatMap((item, i) => rich(["content", "items", i, "text"], item.text)),
  }),
  checklist: defineBlock({
    label: "Checklist",
    description: "Study tasks she can tick off. Tasks are not claims, so no citation is needed.",
    citationsRequired: false,
    content: ChecklistContent,
    example: {
      type: "checklist",
      content: {
        items: ["Learn the cardioselective agents", { text: "Redo quiz 3", checked: true }],
      },
    },
    parts: (c) => c.items.flatMap((item, i) => rich(["content", "items", i, "text"], item.text)),
  }),
  quote: defineBlock({
    label: "Quote",
    description: "A passage quoted from her material or a lecturer, with optional attribution.",
    citationsRequired: true,
    content: QuoteContent,
    example: {
      type: "quote",
      content: { text: "Never stop a beta blocker abruptly.", attribution: "Dr Patel, lecture 7" },
      citations: cite,
    },
    parts: (c) => [
      ...rich(["content", "text"], c.text),
      ...plain(["content", "attribution"], c.attribution),
    ],
  }),
  divider: defineBlock({
    label: "Divider",
    description: "A horizontal rule between sections. Content is empty and may be left out.",
    citationsRequired: false,
    content: DividerContent,
    example: { type: "divider" },
    parts: () => [],
  }),
  table: defineBlock({
    label: "Table",
    description:
      "A grid of rich-text cells. `rows` is a list of rows, each the same length; the first row is a header unless headerRow is false. For drug-by-attribute comparisons prefer comparison_table.",
    citationsRequired: true,
    content: TableContent,
    example: {
      type: "table",
      content: {
        rows: [
          ["Agent", "Selectivity"],
          ["Atenolol", "β1"],
          ["Propranolol", "β1 and β2"],
        ],
      },
      citations: cite,
    },
    parts: (c) => [
      ...c.rows.flatMap((row, r) =>
        row.flatMap((cell, col) => rich(["content", "rows", r, col], cell)),
      ),
      ...plain(["content", "caption"], c.caption),
    ],
  }),
  image: defineBlock({
    label: "Image",
    description:
      "An uploaded page, or a region of one, shown as an image. Needs alt text. The image is its own source, so no citation is needed.",
    citationsRequired: false,
    content: ImageContent,
    example: {
      type: "image",
      content: {
        source: {
          fileId: EXAMPLE_IDS.file,
          pageId: EXAMPLE_IDS.page,
          region: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
        },
        alt: "Diagram of β1 and β2 receptor locations",
      },
    },
    parts: (c) => [...plain(["content", "alt"], c.alt), ...rich(["content", "caption"], c.caption)],
  }),
  callout: defineBlock({
    label: "Callout",
    description:
      "A boxed note with a kind: info, tip, warning, important, definition or exam_tip. Each kind has a default colour token.",
    citationsRequired: true,
    content: CalloutContent,
    example: {
      type: "callout",
      content: {
        kind: "exam_tip",
        text: "Know which beta blockers are cardioselective: atenolol, bisoprolol, metoprolol.",
      },
      citations: cite,
    },
    parts: (c) => [...plain(["content", "title"], c.title), ...rich(["content", "text"], c.text)],
  }),
  drug_card: defineBlock({
    label: "Drug card",
    description:
      "One drug: name, brand names, class, mechanism, indications, adverse effects, contraindications, interactions, monitoring, counselling and dosing notes. Every clinical field is a string or {text, citations, flags}; cite and flag doses individually.",
    citationsRequired: true,
    content: DrugCardContent,
    example: {
      type: "drug_card",
      content: {
        name: "metoprolol",
        brandNames: ["Lopressor", "Toprol-XL"],
        drugClass: "Cardioselective beta blocker",
        adverseEffects: ["Bradycardia", "Fatigue"],
      },
      citations: cite,
    },
    parts: (c) => [
      ...plain(["content", "name"], c.name, c.concept),
      ...c.brandNames.flatMap((brand, i) => plain(["content", "brandNames", i], brand)),
      ...cited(["content", "drugClass"], c.drugClass),
      ...cited(["content", "mechanism"], c.mechanism),
      ...citedLists(["content", "indications"], c.indications),
      ...citedLists(["content", "adverseEffects"], c.adverseEffects),
      ...citedLists(["content", "contraindications"], c.contraindications),
      ...citedLists(["content", "interactions"], c.interactions),
      ...citedLists(["content", "monitoring"], c.monitoring),
      ...citedLists(["content", "counselling"], c.counselling),
      ...citedLists(["content", "dosingNotes"], c.dosingNotes),
    ],
  }),
  comparison_table: defineBlock({
    label: "Comparison table",
    description:
      "Compares drugs or concepts (rows) across attributes (columns). Each row has one cell per attribute; cells are strings or {text, citations, flags}.",
    citationsRequired: true,
    content: ComparisonTableContent,
    example: {
      type: "comparison_table",
      content: {
        attributes: ["Selectivity", "Lipid soluble"],
        rows: [
          { subject: "Atenolol", cells: ["β1", "No"] },
          { subject: "Propranolol", cells: ["β1 and β2", "Yes"] },
        ],
      },
      citations: cite,
    },
    parts: (c) => [
      ...plain(["content", "title"], c.title),
      ...c.attributes.flatMap((attribute, i) => plain(["content", "attributes", i], attribute)),
      ...c.rows.flatMap((row, r) => [
        ...plain(["content", "rows", r, "subject"], row.subject, row.concept),
        ...citedLists(["content", "rows", r, "cells"], row.cells),
      ]),
    ],
  }),
  mnemonic: defineBlock({
    label: "Mnemonic",
    description:
      "A memory device and what each part stands for, in order. Mark generalKnowledge when the mnemonic is not from her notes.",
    citationsRequired: true,
    content: MnemonicContent,
    example: {
      type: "mnemonic",
      content: {
        device: "BAD",
        topic: "Beta-blocker cautions",
        parts: [
          { key: "B", meaning: "Bradycardia" },
          { key: "A", meaning: "Asthma" },
          { key: "D", meaning: "Diabetes (masks hypoglycaemia)" },
        ],
      },
      generalKnowledge: true,
    },
    parts: (c) => [
      ...plain(["content", "device"], c.device),
      ...plain(["content", "topic"], c.topic),
      ...c.parts.flatMap((part, i) => [
        ...plain(["content", "parts", i, "key"], part.key),
        ...rich(["content", "parts", i, "meaning"], part.meaning),
      ]),
      ...rich(["content", "note"], c.note),
    ],
  }),
  labelled_image: defineBlock({
    label: "Labelled image",
    description:
      "An uploaded page or region with tappable hotspots. Hotspot x and y are fractions of the image (0 to 1, from the top-left).",
    citationsRequired: true,
    content: LabelledImageContent,
    example: {
      type: "labelled_image",
      content: {
        image: { fileId: EXAMPLE_IDS.file, pageId: EXAMPLE_IDS.page },
        alt: "Heart and lungs with adrenergic receptors",
        hotspots: [
          { x: 0.42, y: 0.35, label: "β1: heart" },
          { x: 0.7, y: 0.3, label: "β2: bronchial smooth muscle" },
        ],
      },
      citations: cite,
    },
    parts: (c) => [
      ...plain(["content", "alt"], c.alt),
      ...c.hotspots.flatMap((spot, i) => [
        ...plain(["content", "hotspots", i, "label"], spot.label, spot.concept),
        ...rich(["content", "hotspots", i, "detail"], spot.detail),
      ]),
    ],
  }),
  mind_map: defineBlock({
    label: "Mind map",
    description:
      "A tree of short labelled nodes from one root, at most 4 levels below the root and 100 nodes. State structure only; layout is automatic.",
    citationsRequired: true,
    content: MindMapContent,
    example: {
      type: "mind_map",
      content: {
        root: {
          label: "Beta blockers",
          children: [
            {
              label: "Cardioselective",
              children: [{ label: "Atenolol" }, { label: "Metoprolol" }],
            },
            { label: "Non-selective", children: [{ label: "Propranolol" }] },
          ],
        },
      },
      citations: cite,
    },
    parts: (c) =>
      walkMindMap(c.root).flatMap((entry) =>
        plain(["content", ...entry.path, "label"], entry.node.label, entry.node.concept),
      ),
  }),
  question: defineBlock({
    label: "Practice question",
    description:
      "Places an existing practice question in the document by its ID. Create the question first; its citations live on the question.",
    citationsRequired: false,
    content: QuestionContent,
    example: { type: "question", content: { questionId: EXAMPLE_IDS.question } },
    parts: () => [],
  }),
};

type Definitions = typeof DEFINITIONS;
export type BlockType = keyof Definitions;

/** All block types, in the order the block menu shows them. */
export const BLOCK_TYPES = Object.keys(DEFINITIONS) as BlockType[];
export const BlockType = z.enum(BLOCK_TYPES as [BlockType, ...BlockType[]]);

/** Content of a block of type K, after normalisation. */
export type BlockContent<K extends BlockType> = z.output<Definitions[K]["content"]>;

/** Fields every block carries besides its content, as the writer supplies them. */
const writerEnvelope = {
  style: BlockStyle.optional(),
  /** Sources for the whole block. Inline {cite: n} markers point into this list. */
  citations: citationList(CITATION_LIMITS.maxPerBlock),
  /** True when nothing in the block is from her notes; it is labelled "not from your notes". */
  generalKnowledge: z.boolean().default(false),
  /** Things she should check (D10). Always flag doses, units and decimals. */
  flags: z.array(BlockFlag).max(FLAG_LIMITS.maxPerBlock).default([]),
};

interface Envelope {
  style?: BlockStyle | undefined;
  citations: Citation[];
  generalKnowledge: boolean;
  flags: BlockFlag[];
}

/** A block as a writer supplies it, normalised. */
export type BlockInputOf<K extends BlockType> = { type: K; content: BlockContent<K> } & Envelope;
export type BlockInput = { [K in BlockType]: BlockInputOf<K> }[BlockType];

/** A block as stored and returned: the writer's fields plus server-assigned ones. */
export type BlockOf<K extends BlockType> = BlockInputOf<K> & {
  id: string;
  origin: Origin;
  review: BlockReview;
  provenance: Provenance;
};
export type Block = { [K in BlockType]: BlockOf<K> }[BlockType];

/** What a writer may send for a block, before normalisation (strings allowed for rich text). */
export type BlockInputRaw = {
  [K in BlockType]: {
    type: K;
    content?: z.input<Definitions[K]["content"]>;
    style?: z.input<typeof BlockStyle>;
    citations?: z.input<typeof Citation>[];
    generalKnowledge?: boolean;
    flags?: z.input<typeof BlockFlag>[];
  };
}[BlockType];

/** Fields the server fills in; a writer must leave them out. */
export const SERVER_FIELDS = ["id", "origin", "review", "provenance"] as const;

function writerSchemaFor<K extends BlockType>(type: K) {
  return z
    .strictObject({
      type: z.literal(type),
      content: DEFINITIONS[type].content as Definitions[K]["content"],
      ...writerEnvelope,
    })
    .meta({ id: `block_${type}` });
}

function storedSchemaFor<K extends BlockType>(type: K) {
  return z.object({
    id: BlockId,
    type: z.literal(type),
    content: DEFINITIONS[type].content as Definitions[K]["content"],
    ...writerEnvelope,
    origin: Origin,
    review: BlockReview,
    provenance: Provenance,
  });
}

export type BlockRegistryEntry<K extends BlockType> = Definitions[K] & {
  type: K;
  /** Writer input for this type (no server fields). */
  inputSchema: z.ZodType<BlockInputOf<K>>;
  /** Stored block of this type. */
  schema: z.ZodType<BlockOf<K>>;
};

export const BLOCK_REGISTRY = Object.fromEntries(
  BLOCK_TYPES.map((type) => [
    type,
    {
      ...DEFINITIONS[type],
      type,
      inputSchema: writerSchemaFor(type),
      schema: storedSchemaFor(type),
    },
  ]),
) as unknown as { [K in BlockType]: BlockRegistryEntry<K> };

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && Object.hasOwn(DEFINITIONS, value);
}

/** Readable parts of a block's content, in reading order. */
export function blockParts(block: { type: BlockType; content: unknown }): ContentPart[] {
  const definition = DEFINITIONS[block.type] as BlockDefinition<z.ZodType>;
  return definition.parts(block.content);
}

/** A problem found in a block, with where it is. */
export interface BlockIssue {
  path: BlockPath;
  message: string;
}

/**
 * Checks that span content and envelope, so no single field schema can make
 * them: citation markers must point at a citation that exists, and a block
 * marked general knowledge cannot also cite her notes.
 */
export function envelopeIssues(block: BlockInput): BlockIssue[] {
  const issues: BlockIssue[] = [];
  if (block.generalKnowledge && block.citations.length > 0) {
    issues.push({
      path: ["generalKnowledge"],
      message:
        'generalKnowledge: true says nothing in this block is from her notes, so it cannot also have citations. Remove generalKnowledge, or remove the citations; to mark one field only, set "generalKnowledge": true on that field.',
    });
  }
  for (const part of blockParts(block)) {
    const own = part.field && part.field.citations.length > 0 ? part.field.citations : null;
    const scope = own ?? block.citations;
    for (const marker of citationMarkers(part.text)) {
      if (marker > scope.length) {
        const where = own ? "this field's citations" : "the block's citations";
        issues.push({
          path: part.path,
          message: `Citation marker {"cite": ${marker}} points to citation ${marker}, but ${where} list has ${scope.length}. Markers count from 1 into the nearest citations list.`,
        });
      }
    }
  }
  return issues;
}

function addIssues(block: BlockInput, ctx: z.RefinementCtx) {
  for (const issue of envelopeIssues(block)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}

/**
 * Any block as a writer supplies it, discriminated on `type`. Server fields
 * are rejected. The citation rule depends on who is writing, so it is
 * checked by `validateBlockInput`, not here.
 */
export const BlockInput = z
  .discriminatedUnion(
    "type",
    BLOCK_TYPES.map((type) => BLOCK_REGISTRY[type].inputSchema) as unknown as [
      ReturnType<typeof writerSchemaFor>,
      ...ReturnType<typeof writerSchemaFor>[],
    ],
  )
  .superRefine((block, ctx) => addIssues(block as BlockInput, ctx)) as unknown as z.ZodType<
  BlockInput,
  BlockInputRaw
>;

/** Any stored block, discriminated on `type`. */
export const Block = z
  .discriminatedUnion(
    "type",
    BLOCK_TYPES.map((type) => BLOCK_REGISTRY[type].schema) as unknown as [
      ReturnType<typeof storedSchemaFor>,
      ...ReturnType<typeof storedSchemaFor>[],
    ],
  )
  .superRefine((block, ctx) => addIssues(block as BlockInput, ctx)) as unknown as z.ZodType<Block>;
