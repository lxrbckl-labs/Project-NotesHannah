import { BLOCK_REGISTRY, type Block, type BlockType, isBlockType } from "@notes/schema";
import { convertContent, isListType, isTextType, turnInto } from "./gestures";
import type { PendingCall } from "./ops";

/**
 * The ribbon's "block style" list: what the caret's block is, and turning it
 * into another style. Styles are block types (a heading's level counts as its
 * own style, as in a word processor's style list); converting uses the same
 * replace as the block menu's "Turn into" and the typing shortcuts.
 */

export type BlockStyleId =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "quote"
  | "callout"
  | "bulleted_list"
  | "numbered_list"
  | "checklist";

export interface BlockStyleOption {
  id: BlockStyleId;
  label: string;
  type: BlockType;
  level?: 1 | 2 | 3;
  /** What to type at the start of a paragraph for the same result. */
  typed?: string;
}

export const BLOCK_STYLES: readonly BlockStyleOption[] = [
  { id: "paragraph", label: "Text", type: "paragraph" },
  { id: "heading1", label: "Heading 1", type: "heading", level: 1, typed: "#" },
  { id: "heading2", label: "Heading 2", type: "heading", level: 2, typed: "##" },
  { id: "heading3", label: "Heading 3", type: "heading", level: 3, typed: "###" },
  { id: "quote", label: "Quote", type: "quote", typed: ">" },
  { id: "bulleted_list", label: "Bulleted list", type: "bulleted_list", typed: "-" },
  { id: "numbered_list", label: "Numbered list", type: "numbered_list", typed: "1." },
  { id: "checklist", label: "Checklist", type: "checklist", typed: "[]" },
  { id: "callout", label: "Callout", type: "callout", typed: "!!" },
];

export function styleOption(id: BlockStyleId): BlockStyleOption {
  return BLOCK_STYLES.find((s) => s.id === id) as BlockStyleOption;
}

/** True when the block's style can be changed from the ribbon (text and list blocks). */
export function canRestyle(block: Pick<Block, "type">): boolean {
  return isTextType(block.type) || isListType(block.type);
}

/** The style the block has now; null for blocks the list does not cover (tables, cards...). */
export function styleOf(block: Block): BlockStyleId | null {
  if (block.type === "heading") return `heading${block.content.level}` as BlockStyleId;
  return canRestyle(block) ? (block.type as BlockStyleId) : null;
}

/** A plain name for any block, for the style control when it cannot convert. */
export function blockLabel(block: Pick<Block, "type">): string {
  return isBlockType(block.type) ? BLOCK_REGISTRY[block.type].label : "Block";
}

/** The calls that give `block` the chosen style; null when it already has it or cannot. */
export function restyleCalls(
  documentId: string,
  block: Block,
  id: BlockStyleId,
): PendingCall[] | null {
  if (!canRestyle(block) || styleOf(block) === id) return null;
  const option = styleOption(id);
  if (option.type === "heading") {
    // Converting keeps the text; the level is the style's, not the default.
    const content = convertContent(block, "heading") as Record<string, unknown>;
    return turnInto(documentId, block, "heading", { ...content, level: option.level });
  }
  return turnInto(documentId, block, option.type);
}

/** Where the caret is, as a line and an offset in it (single-line fields count hard breaks as lines). */
export interface Caret {
  line: number;
  offset: number;
  /** The size of every line, in editor positions (a chip counts one). */
  lines: number[];
}

/**
 * The editor position to focus after a conversion, for the editor the new
 * block mounts (`InlineEditor`'s numeric `autoFocus`). A single-line field
 * keeps its hard breaks as breaks (one position each); a list editor has one
 * paragraph per line (two positions between lines).
 */
export function caretAfter(caret: Caret, target: BlockType): number {
  const toLines = isListType(target);
  let at = 0;
  for (let i = 0; i < caret.line; i++) at += (caret.lines[i] ?? 0) + (toLines ? 2 : 1);
  return at + caret.offset;
}
