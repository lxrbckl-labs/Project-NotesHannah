import {
  type Block,
  type BlockInput,
  type BlockStyle,
  type BlockType,
  blockPlainText,
  CITATION_LIMITS,
  type ImageSource,
  newId,
  normalizeRichText,
  type RichText,
} from "@notes/schema";
import { inputOf, type PendingCall } from "./ops";
import { joinRichText, shiftCitations } from "./richtext";

/**
 * Editing gestures as writer operations. Each function returns the exact
 * calls a gesture sends; the controller applies them optimistically and the
 * store receives them unchanged. Tests assert these shapes.
 */

/** Block types whose main content is one piece of rich text in `content.text`. */
export const TEXT_TYPES = ["paragraph", "heading", "quote", "callout"] as const;
export type TextType = (typeof TEXT_TYPES)[number];
export const LIST_TYPES = ["bulleted_list", "numbered_list", "checklist"] as const;
export type ListType = (typeof LIST_TYPES)[number];

export function isTextType(type: string): type is TextType {
  return (TEXT_TYPES as readonly string[]).includes(type);
}
export function isListType(type: string): type is ListType {
  return (LIST_TYPES as readonly string[]).includes(type);
}

/** Types she can insert from the "/" menu or the "+" button, in menu order. */
export const INSERTABLE_TYPES: BlockType[] = [
  "paragraph",
  "heading",
  "bulleted_list",
  "numbered_list",
  "checklist",
  "callout",
  "quote",
  "divider",
  "table",
  "drug_card",
  "comparison_table",
  "mnemonic",
  "mind_map",
  "image",
  "labelled_image",
];

/** Types that need a source page chosen before they can be inserted. */
export const NEEDS_PAGE: BlockType[] = ["image", "labelled_image"];

/** A fresh, valid content for a block type she inserts. */
export function defaultContent(
  type: BlockType,
  options: { text?: RichText; level?: 1 | 2 | 3; image?: ImageSource; alt?: string } = {},
): unknown {
  const text = options.text ?? [];
  const plain = text
    .map((item) => ("text" in item ? item.text : ""))
    .join("")
    .trim();
  switch (type) {
    case "paragraph":
      return { text };
    case "heading":
      return { level: options.level ?? 2, text };
    case "quote":
      return { text };
    case "callout":
      return { kind: "info", text };
    case "bulleted_list":
    case "numbered_list":
      return { items: [{ text, indent: 0 }] };
    case "checklist":
      return { items: [{ text, checked: false }] };
    case "divider":
      return {};
    case "table":
      return {
        rows: [
          [plain || "Column 1", "Column 2"],
          ["", ""],
        ],
        headerRow: true,
      };
    case "drug_card":
      return { name: plain || "New drug" };
    case "comparison_table":
      return {
        attributes: ["Selectivity", "Notes"],
        rows: [
          { subject: plain || "Drug A", cells: ["", ""] },
          { subject: "Drug B", cells: ["", ""] },
        ],
      };
    case "mnemonic":
      return { device: plain || "ABC", parts: [{ key: "A", meaning: "" }] };
    case "mind_map":
      return { root: { label: plain || "Main idea", children: [{ label: "Branch" }] } };
    case "image":
      return { source: options.image, alt: options.alt ?? "Page image" };
    case "labelled_image":
      return {
        image: options.image,
        alt: options.alt ?? "Labelled page image",
        hotspots: [{ x: 0.5, y: 0.5, label: "Label" }],
      };
    case "question":
      return { questionId: "qst_00000000000000000000000000" };
  }
}

export function newBlockInput(type: BlockType, options: Parameters<typeof defaultContent>[1] = {}) {
  return { type, content: defaultContent(type, options) } as BlockInput;
}

/** Insert a new block after `afterId` (or at the start when null). */
export function insertBlock(
  documentId: string,
  afterId: string | null,
  block: BlockInput,
  clientId: string = newId("block"),
): PendingCall[] {
  return [
    {
      call: {
        operation: "insert_blocks",
        input: { documentId, blocks: [block], position: afterId ? { after: afterId } : "start" },
      },
      clientIds: [clientId],
    },
  ];
}

/** Replace some content fields of a block (typing, structured editors). */
export function patchContent(
  documentId: string,
  blockId: string,
  content: Record<string, unknown>,
): PendingCall[] {
  return [
    {
      call: {
        operation: "update_block",
        input: { mode: "patch", documentId, blockId, patch: { content } },
      },
    },
  ];
}

/**
 * Change content fields, some of them cleared (undefined). A JSON patch cannot
 * remove a field, so this replaces the whole block with the merged content.
 */
export function replaceContent(
  documentId: string,
  block: Block,
  content: Record<string, unknown>,
): PendingCall[] {
  const input = inputOf(block);
  const merged: Record<string, unknown> = { ...(input.content as object), ...content };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return [
    {
      call: {
        operation: "update_block",
        input: {
          mode: "replace",
          documentId,
          blockId: block.id,
          block: { ...input, content: merged } as unknown as BlockInput,
        },
      },
    },
  ];
}

/** Change a block's colour; null clears the style. */
export function setStyle(
  documentId: string,
  blockId: string,
  style: BlockStyle | null,
): PendingCall[] {
  return [
    {
      call: {
        operation: "update_block",
        input: { mode: "patch", documentId, blockId, patch: { style } },
      },
    },
  ];
}

/**
 * Enter in the middle of a text block: the block keeps the text before the
 * cursor and a new paragraph after it takes the rest. Citation markers in the
 * moved text keep pointing at the same citations, which are copied over.
 */
export function splitTextBlock(
  documentId: string,
  block: Block,
  before: RichText,
  after: RichText,
  clientId: string = newId("block"),
): PendingCall[] {
  const movesMarkers = after.some((item) => "cite" in item);
  const fresh: Record<string, unknown> = { type: "paragraph", content: { text: after } };
  if (movesMarkers) fresh.citations = block.citations;
  return [
    ...patchContent(documentId, block.id, { text: before }),
    ...insertBlock(documentId, block.id, fresh as unknown as BlockInput, clientId),
  ];
}

/**
 * Backspace at the start of a text block: its text joins the previous text
 * block (citations appended, markers renumbered) and the block is removed.
 * Returns null when the previous block cannot take the text.
 */
export function mergeIntoPrevious(
  documentId: string,
  previous: Block,
  block: Block,
  text: RichText,
): PendingCall[] | null {
  if (!isTextType(previous.type)) return null;
  const prevText = (previous.content as { text: RichText }).text;
  const total = previous.citations.length + block.citations.length;
  if (total > CITATION_LIMITS.maxPerBlock) return null;
  if (previous.generalKnowledge !== block.generalKnowledge && block.citations.length > 0)
    return null;
  const joined = joinRichText(prevText, shiftCitations(text, previous.citations.length));
  const patch: Record<string, unknown> = { content: { text: joined } };
  if (block.citations.length > 0) patch.citations = [...previous.citations, ...block.citations];
  return [
    {
      call: {
        operation: "update_block",
        input: { mode: "patch", documentId, blockId: previous.id, patch },
      },
    },
    { call: { operation: "delete_blocks", input: { documentId, blockIds: [block.id] } } },
  ];
}

export function deleteBlocks(documentId: string, blockIds: string[]): PendingCall[] {
  return [{ call: { operation: "delete_blocks", input: { documentId, blockIds } } }];
}

export function duplicateBlock(
  documentId: string,
  block: Block,
  clientId: string = newId("block"),
): PendingCall[] {
  return insertBlock(documentId, block.id, inputOf(block), clientId);
}

/** Move one block up or down by one place. Null at the edge. */
export function moveBy(
  documentId: string,
  order: readonly string[],
  blockId: string,
  delta: -1 | 1,
): PendingCall[] | null {
  const at = order.indexOf(blockId);
  const target = at + delta;
  if (at < 0 || target < 0 || target >= order.length) return null;
  const anchor = order[target] as string;
  return [
    {
      call: {
        operation: "move_blocks",
        input: {
          documentId,
          blockIds: [blockId],
          position: delta < 0 ? { before: anchor } : { after: anchor },
        },
      },
    },
  ];
}

/** Drop a dragged block before the block now at `beforeId` (or at the end when null). */
export function moveTo(
  documentId: string,
  blockId: string,
  beforeId: string | null,
): PendingCall[] {
  return [
    {
      call: {
        operation: "move_blocks",
        input: {
          documentId,
          blockIds: [blockId],
          position: beforeId ? { before: beforeId } : "end",
        },
      },
    },
  ];
}

function textOf(block: Block): RichText {
  const content = block.content as Record<string, unknown>;
  if (isTextType(block.type)) return content.text as RichText;
  if (isListType(block.type)) {
    const items = content.items as Array<{ text: RichText }>;
    const out: RichText = [];
    items.forEach((item, i) => {
      if (i > 0) out.push({ text: "\n" });
      out.push(...item.text);
    });
    return normalizeRichText(out);
  }
  return normalizeRichText(blockPlainText(block).split("\n")[0] ?? "");
}

/** Content for `block` turned into `type`, keeping as much of its text as fits. */
export function convertContent(block: Block, type: BlockType): unknown {
  const content = block.content as Record<string, unknown>;
  if (isListType(block.type) && isListType(type)) {
    const items = (
      content.items as Array<{ text: RichText; indent?: number; checked?: boolean }>
    ).map((item) =>
      type === "checklist"
        ? { text: item.text, checked: Boolean(item.checked) }
        : { text: item.text, indent: item.indent ?? 0 },
    );
    return { items };
  }
  if (isTextType(block.type) && isTextType(type)) {
    const text = content.text as RichText;
    if (type === "heading") {
      const plain = text.filter((item) => !("cite" in item));
      return { level: 2, text: plain };
    }
    if (type === "callout")
      return {
        kind: (content.kind as string) ?? "info",
        text,
        ...(content.title ? { title: content.title } : {}),
      };
    return { text };
  }
  if (isListType(type)) {
    const lines = textOf(block);
    const items: RichText[] = [[]];
    for (const item of lines) {
      if ("text" in item && !("concept" in item) && item.text.includes("\n")) {
        const parts = item.text.split("\n");
        parts.forEach((part, i) => {
          if (i > 0) items.push([]);
          if (part) (items[items.length - 1] as RichText).push({ ...item, text: part });
        });
      } else (items[items.length - 1] as RichText).push(item);
    }
    return {
      items: items.map((text) =>
        type === "checklist"
          ? { text, checked: false }
          : { text: normalizeRichText(text), indent: 0 },
      ),
    };
  }
  const text = textOf(block);
  if (type === "heading") return { level: 2, text: text.filter((item) => !("cite" in item)) };
  return defaultContent(type, { text });
}

/** Turn a block into another type: a replace keeping citations, flags and colour. */
export function turnInto(
  documentId: string,
  block: Block,
  type: BlockType,
  /** Content to use instead of converting the block's own (typing shortcuts hold newer text). */
  content: unknown = convertContent(block, type),
): PendingCall[] {
  const input = inputOf(block);
  const next: Record<string, unknown> = {
    type,
    content,
    citations: input.citations,
    generalKnowledge: input.generalKnowledge,
    flags: input.flags,
  };
  if (input.style) next.style = input.style;
  if (type === "heading" || type === "divider") {
    // Headings and dividers hold no citation markers; keep the sources on the block.
    if (type === "divider") next.citations = [];
  }
  return [
    {
      call: {
        operation: "update_block",
        input: {
          mode: "replace",
          documentId,
          blockId: block.id,
          block: next as unknown as BlockInput,
        },
      },
    },
  ];
}

/** The types a block can sensibly be turned into from the block menu. */
export function turnIntoTargets(block: Block): BlockType[] {
  if (isTextType(block.type) || isListType(block.type))
    return [...TEXT_TYPES, ...LIST_TYPES].filter((type) => type !== block.type);
  return [];
}
