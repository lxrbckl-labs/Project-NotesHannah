import { type Block, type BlockInput, newId, type RichText } from "@notes/schema";
import { insertBlock, newBlockInput, turnInto } from "./gestures";
import type { PendingCall } from "./ops";

/**
 * Typing shortcuts at the start of a paragraph ("# " for a heading, "- " for a
 * bullet list...). The editor spots the trigger; this decides what it means
 * and builds the calls, so the controller's undo covers them like any gesture.
 */

export type Shortcut =
  | { type: "heading"; level: 1 | 2 | 3 }
  | { type: "bulleted_list" | "numbered_list" | "checklist" | "quote" | "divider" }
  | { type: "callout"; kind: "warning" | "tip" };

/** What the editor looks for: the typed prefix, then the space that completes it. */
export const SHORTCUT_PREFIX = /^(#+|[-*]|\d+[.)]|\[ ?\]|>|!!|\?\?|---) $/;

/** The meaning of a trigger (the text typed before the space), or null when it is none. */
export function shortcutFor(trigger: string): Shortcut | null {
  if (/^#+$/.test(trigger)) {
    // The schema stops at level 3; more hashes still make the smallest heading she has.
    return { type: "heading", level: Math.min(trigger.length, 3) as 1 | 2 | 3 };
  }
  if (trigger === "-" || trigger === "*") return { type: "bulleted_list" };
  if (/^\d+[.)]$/.test(trigger)) return { type: "numbered_list" };
  if (trigger === "[]" || trigger === "[ ]") return { type: "checklist" };
  if (trigger === ">") return { type: "quote" };
  if (trigger === "!!") return { type: "callout", kind: "warning" };
  if (trigger === "??") return { type: "callout", kind: "tip" };
  if (trigger === "---") return { type: "divider" };
  return null;
}

export interface ShortcutResult {
  calls: PendingCall[];
  /** The block that takes the caret. */
  focusId: string;
}

/**
 * Turn a paragraph into what the trigger asks for, keeping `rest` (the text
 * after the trigger). A divider has no text, so it only applies to an empty
 * rest and leaves a fresh paragraph after it for the caret.
 */
export function applyShortcut(
  documentId: string,
  block: Block,
  shortcut: Shortcut,
  rest: RichText,
): ShortcutResult | null {
  if (block.type !== "paragraph") return null;
  if (shortcut.type === "divider") return dividerAfter(documentId, block, rest);
  // Headings hold no citation markers.
  const text = shortcut.type === "heading" ? rest.filter((item) => !("cite" in item)) : rest;
  const { content } = newBlockInput(shortcut.type, {
    text,
    ...(shortcut.type === "heading" ? { level: shortcut.level } : {}),
  }) as { content: object };
  const next = shortcut.type === "callout" ? { ...content, kind: shortcut.kind } : content;
  return { calls: turnInto(documentId, block, shortcut.type, next), focusId: block.id };
}

/** "---" and Enter: the paragraph becomes a divider and an empty paragraph follows. */
export function dividerAfter(
  documentId: string,
  block: Block,
  rest: RichText,
): ShortcutResult | null {
  if (block.type !== "paragraph" || rest.length > 0) return null;
  const focusId = newId("block");
  const paragraph: BlockInput = newBlockInput("paragraph");
  return {
    calls: [
      ...turnInto(documentId, block, "divider"),
      ...insertBlock(documentId, block.id, paragraph, focusId),
    ],
    focusId,
  };
}

/** True when the plain text is exactly "---" (a divider typed with Enter). */
export function isDividerText(text: RichText): boolean {
  const only = text[0];
  return text.length === 1 && only !== undefined && "text" in only && only.text.trim() === "---";
}
