import { z } from "zod";
import { ConceptId, QuestionId } from "../ids.js";
import { CitedText, citedList, ImageSource } from "./common.js";
import { normalizeRichText, type RichText, richText } from "./rich-text.js";
import { CalloutKind, ColorToken } from "./tokens.js";

/**
 * The content of each block type: what goes in a block's `content`. The
 * envelope around it (id, citations, provenance) is shared and lives in
 * registry.ts. Limits are deliberately generous for study material but
 * small enough that one block stays one readable unit on a phone.
 */
export const BLOCK_LIMITS = {
  headingChars: 300,
  paragraphChars: 10_000,
  listItems: 100,
  listItemChars: 2000,
  /** Deepest list indent (0 is top level). */
  listMaxIndent: 2,
  quoteChars: 5000,
  attributionChars: 200,
  tableRows: 60,
  tableColumns: 10,
  tableCellChars: 2000,
  captionChars: 1000,
  altChars: 500,
  calloutTitleChars: 120,
  calloutChars: 5000,
  drugNameChars: 120,
  brandNames: 10,
  brandNameChars: 60,
  /** Most entries in each list field of a drug card (indications, adverse effects, …). */
  drugListEntries: 20,
  comparisonRows: 20,
  comparisonColumns: 10,
  comparisonLabelChars: 120,
  mnemonicDeviceChars: 200,
  mnemonicParts: 26,
  mnemonicPartKeyChars: 40,
  mnemonicMeaningChars: 500,
  hotspots: 30,
  hotspotLabelChars: 80,
  mindMapNodes: 100,
  /** Deepest mind map level below the root (the root is depth 0). */
  mindMapMaxDepth: 4,
  mindMapChildren: 12,
  mindMapLabelChars: 120,
} as const;

const L = BLOCK_LIMITS;

const shortText = (max: number) => z.string().trim().min(1).max(max);

export const HeadingContent = z.strictObject({
  level: z.literal([1, 2, 3], { error: "Heading level is 1, 2 or 3." }),
  text: richText(L.headingChars),
});

export const ParagraphContent = z.strictObject({
  text: richText(L.paragraphChars),
});

const ListItemObject = z.strictObject({
  text: richText(L.listItemChars),
  /** Nesting level, 0 to 2. Each item may be at most one level deeper than the one before. */
  indent: z.number().int().min(0).max(L.listMaxIndent).default(0),
});

export interface ListItem {
  text: RichText;
  indent: number;
}

/** A list item; a plain string is a top-level item. */
export const ListItem = z
  .union([z.string().max(L.listItemChars), ListItemObject], {
    error: 'A list item is a string, or {"text": "...", "indent": 1}.',
  })
  .transform(
    (item): ListItem =>
      typeof item === "string" ? { text: normalizeRichText(item), indent: 0 } : item,
  );

function indentsStepByOne(items: ListItem[]): boolean {
  let previous = -1;
  for (const item of items) {
    if (item.indent > previous + 1) return false;
    previous = item.indent;
  }
  return true;
}

const listItems = z
  .array(ListItem)
  .min(1, { error: "A list needs at least one item." })
  .max(L.listItems, { error: `A list holds at most ${L.listItems} items; split it.` })
  .refine(indentsStepByOne, {
    error:
      "Indents may grow by one level at a time, starting at 0: an item can only nest under the item before it.",
  });

export const BulletedListContent = z.strictObject({ items: listItems });

export const NumberedListContent = z.strictObject({
  items: listItems,
  /** Number of the first item. */
  start: z.number().int().min(0).max(9999).optional(),
});

const ChecklistItemObject = z.strictObject({
  text: richText(L.listItemChars),
  checked: z.boolean().default(false),
});
export interface ChecklistItem {
  text: RichText;
  checked: boolean;
}
export const ChecklistItem = z
  .union([z.string().max(L.listItemChars), ChecklistItemObject], {
    error: 'A checklist item is a string, or {"text": "...", "checked": true}.',
  })
  .transform(
    (item): ChecklistItem =>
      typeof item === "string" ? { text: normalizeRichText(item), checked: false } : item,
  );

export const ChecklistContent = z.strictObject({
  items: z
    .array(ChecklistItem)
    .min(1, { error: "A checklist needs at least one item." })
    .max(L.listItems),
});

export const QuoteContent = z.strictObject({
  text: richText(L.quoteChars),
  /** Who said or wrote it, e.g. "Dr Patel, lecture 7". */
  attribution: shortText(L.attributionChars).optional(),
});

export const DividerContent = z.strictObject({}).default({});

export const TableContent = z
  .strictObject({
    /** Rows of cells, top to bottom. Every row has the same number of cells. */
    rows: z
      .array(
        z
          .array(richText(L.tableCellChars))
          .min(1)
          .max(L.tableColumns, { error: `A table has at most ${L.tableColumns} columns.` }),
      )
      .min(1)
      .max(L.tableRows, { error: `A table has at most ${L.tableRows} rows; split it.` }),
    /** The first row is a header. */
    headerRow: z.boolean().default(true),
    /** The first column is a header. */
    headerColumn: z.boolean().default(false),
    caption: shortText(L.captionChars).optional(),
  })
  .refine((table) => table.rows.every((row) => row.length === table.rows[0]?.length), {
    error: "Every table row needs the same number of cells; use an empty string for a blank cell.",
    path: ["rows"],
  });

export const ImageContent = z.strictObject({
  source: ImageSource,
  /** What the image shows, for screen readers and search. */
  alt: shortText(L.altChars),
  caption: richText(L.captionChars).optional(),
});

export const CalloutContent = z.strictObject({
  kind: CalloutKind,
  title: shortText(L.calloutTitleChars).optional(),
  text: richText(L.calloutChars),
});

const drugList = () => citedList(L.drugListEntries);

/**
 * A drug card. Every clinical field is citable and flaggable on its own,
 * because a wrong dose or interaction matters more than a wrong sentence.
 */
export const DrugCardContent = z.strictObject({
  /** Generic name, e.g. "metoprolol tartrate". */
  name: shortText(L.drugNameChars),
  concept: ConceptId.optional(),
  brandNames: z.array(shortText(L.brandNameChars)).max(L.brandNames).default([]),
  drugClass: CitedText.optional(),
  mechanism: CitedText.optional(),
  indications: drugList(),
  adverseEffects: drugList(),
  contraindications: drugList(),
  interactions: drugList(),
  monitoring: drugList(),
  counselling: drugList(),
  dosingNotes: drugList(),
});

export const ComparisonTableContent = z
  .strictObject({
    title: shortText(L.comparisonLabelChars).optional(),
    /** Column headings: what is compared, e.g. "Selectivity", "Half-life". */
    attributes: z
      .array(shortText(L.comparisonLabelChars))
      .min(1)
      .max(L.comparisonColumns, { error: `At most ${L.comparisonColumns} attributes.` }),
    /** One row per drug or concept, with one cell per attribute, in attribute order. */
    rows: z
      .array(
        z.strictObject({
          subject: shortText(L.comparisonLabelChars),
          concept: ConceptId.optional(),
          cells: z.array(CitedText).max(L.comparisonColumns),
        }),
      )
      .min(2, { error: "A comparison needs at least two rows." })
      .max(L.comparisonRows, { error: `At most ${L.comparisonRows} rows; split the comparison.` }),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, index) => {
      if (row.cells.length !== table.attributes.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "cells"],
          message: `Row "${row.subject}" has ${row.cells.length} cells but there are ${table.attributes.length} attributes; give one cell per attribute, "" for none.`,
        });
      }
    });
  });

export const MnemonicContent = z.strictObject({
  /** The device itself, e.g. "BAD" or "Big Athletes Don't Bend". */
  device: shortText(L.mnemonicDeviceChars),
  /** What it helps remember, e.g. "Beta-blocker contraindications". */
  topic: shortText(L.mnemonicDeviceChars).optional(),
  /** Each letter or word and what it stands for, in order. */
  parts: z
    .array(
      z.strictObject({
        key: shortText(L.mnemonicPartKeyChars),
        meaning: richText(L.mnemonicMeaningChars),
      }),
    )
    .min(1)
    .max(L.mnemonicParts),
  note: richText(L.captionChars).optional(),
});

export const Hotspot = z.strictObject({
  /** Position as a fraction of the image: 0,0 top-left, 1,1 bottom-right. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  label: shortText(L.hotspotLabelChars),
  /** Shown when the hotspot is tapped. */
  detail: richText(L.captionChars).optional(),
  concept: ConceptId.optional(),
});
export type Hotspot = z.infer<typeof Hotspot>;

export const LabelledImageContent = z.strictObject({
  image: ImageSource,
  alt: shortText(L.altChars),
  hotspots: z
    .array(Hotspot)
    .min(1, { error: "A labelled image needs at least one hotspot; use an image block otherwise." })
    .max(L.hotspots),
});

/** One node of a mind map. Plain-text labels keep maps readable at any zoom. */
export interface MindMapNode {
  label: string;
  concept?: string | undefined;
  color?: ColorToken | undefined;
  children?: MindMapNode[] | undefined;
}

export const MindMapNode: z.ZodType<MindMapNode> = z.strictObject({
  label: shortText(L.mindMapLabelChars),
  concept: ConceptId.optional(),
  color: ColorToken.optional(),
  get children() {
    return z
      .array(MindMapNode)
      .max(L.mindMapChildren, {
        error: `A mind map node has at most ${L.mindMapChildren} children.`,
      })
      .optional();
  },
});

/** Every node of a mind map with its depth, root first, depth-first. */
export function walkMindMap(
  root: MindMapNode,
): Array<{ node: MindMapNode; depth: number; path: (string | number)[] }> {
  const out: Array<{ node: MindMapNode; depth: number; path: (string | number)[] }> = [];
  const visit = (node: MindMapNode, depth: number, path: (string | number)[]) => {
    out.push({ node, depth, path });
    node.children?.forEach((child, i) => {
      visit(child, depth + 1, [...path, "children", i]);
    });
  };
  visit(root, 0, ["root"]);
  return out;
}

export const MindMapContent = z.strictObject({ root: MindMapNode }).superRefine((map, ctx) => {
  const nodes = walkMindMap(map.root);
  if (nodes.length > L.mindMapNodes) {
    ctx.addIssue({
      code: "custom",
      path: ["root"],
      message: `A mind map holds at most ${L.mindMapNodes} nodes; this one has ${nodes.length}. Split it into several maps.`,
    });
  }
  const tooDeep = nodes.find((entry) => entry.depth > L.mindMapMaxDepth);
  if (tooDeep) {
    ctx.addIssue({
      code: "custom",
      path: tooDeep.path,
      message: `A mind map goes at most ${L.mindMapMaxDepth} levels below the root; "${tooDeep.node.label}" is at level ${tooDeep.depth}.`,
    });
  }
});

/** A practice question placed in the document. The question itself (and its citations) lives in the practice schema. */
export const QuestionContent = z.strictObject({ questionId: QuestionId });
