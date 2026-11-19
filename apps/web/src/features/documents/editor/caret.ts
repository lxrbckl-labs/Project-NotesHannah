import type { Block, BlockStyle, ColorToken } from "@notes/schema";
import type { Editor } from "@tiptap/core";
import { type DocActions, useActions, useSignal } from "../context";
import {
  type BlockStyleId,
  type Caret,
  caretAfter,
  restyleCalls,
  styleOption,
} from "../model/blockStyle";
import { isListType, setStyle } from "../model/gestures";
import { indentRoom } from "./lines";
import { useEditorValue } from "./tools";

/**
 * What the ribbon acts on: the editor the caret is (or was last) in and the
 * block around it. The editor stays the target while it is mounted, so a
 * ribbon menu that takes the focus for a moment still knows where to act.
 */

export interface CaretTarget {
  editor: Editor | null;
  block: Block | null;
  /** The caret is in the text right now (not just remembered). */
  focused: boolean;
  /** The editor is a list's (one paragraph per line). */
  lines: boolean;
  indent: boolean;
  outdent: boolean;
}

function readPlace(e: Editor) {
  const lines = e.view.dom.classList.contains("doc-lines-editor");
  const room = lines ? indentRoom(e) : { indent: false, outdent: false };
  return { focused: e.isFocused, lines, ...room };
}

/** The ribbon's target, live: re-renders as the caret moves between blocks and lines. */
export function useCaretTarget(blocks: readonly Block[]): CaretTarget {
  const actions = useActions();
  const caret = useSignal(actions.caretEditor, (c) => c);
  const live = caret && !caret.editor.isDestroyed ? caret.editor : null;
  const state = useEditorValue(live, readPlace, null);
  const block = live ? (blocks.find((b) => b.id === caret?.blockId) ?? null) : null;
  return {
    editor: live,
    block,
    focused: Boolean(state?.focused),
    lines: Boolean(state?.lines),
    indent: Boolean(state?.indent),
    outdent: Boolean(state?.outdent),
  };
}

/** Where the caret is in an editor, as a line and an offset, with every line's size. */
export function caretOf(editor: Editor): Caret {
  const { doc, selection } = editor.state;
  const pos = selection.from;
  const lines: number[] = [];
  let line = 0;
  let offset = 0;
  if (doc.childCount > 1) {
    // A list editor: one paragraph per line, each starting one position after its own start.
    doc.forEach((paragraph, start, index) => {
      lines.push(paragraph.content.size);
      const from = start + 1;
      if (pos >= from && pos <= from + paragraph.content.size) {
        line = index;
        offset = pos - from;
      }
    });
    return { line, offset, lines };
  }
  // A single paragraph: hard breaks start new lines.
  const paragraph = doc.firstChild;
  let size = 0;
  let lineStart = 1;
  paragraph?.forEach((child, off) => {
    const at = 1 + off;
    if (child.type.name === "hardBreak") {
      lines.push(size);
      size = 0;
      if (pos > at) {
        line = lines.length;
        lineStart = at + 1;
      }
    } else size += child.nodeSize;
  });
  lines.push(size);
  offset = Math.max(0, pos - lineStart);
  return { line, offset, lines };
}

/** The current version of a block, after any unsaved typing has been committed. */
function freshBlock(actions: DocActions, blockId: string): Block | null {
  actions.controller.flushEditors();
  const doc = actions.controller.getState().doc;
  return doc?.blocks.find((b) => b.id === blockId) ?? null;
}

/**
 * Give the caret's block another style (Text, Heading 2, Checklist...) and put
 * the caret back where it was in the converted block. Returns false when
 * nothing changed.
 */
export function restyle(
  actions: DocActions,
  editor: Editor,
  blockId: string,
  id: BlockStyleId,
): boolean {
  const caret = caretOf(editor);
  const block = freshBlock(actions, blockId);
  if (!block) return false;
  const calls = restyleCalls(actions.documentId, block, id);
  if (!calls) {
    editor.commands.focus();
    return false;
  }
  const ok = actions.perform(calls, "Turn into");
  // The block's component changes with its type, so a new editor mounts and takes the caret.
  if (ok) actions.requestFocus(blockId, caretAfter(caret, styleOption(id).type));
  return ok;
}

/** A list button: make the block that list, or back to text when it already is one. */
export function toggleList(
  actions: DocActions,
  editor: Editor,
  block: Block,
  id: "bulleted_list" | "numbered_list" | "checklist",
): boolean {
  return restyle(
    actions,
    editor,
    block.id,
    block.type === id && isListType(block.type) ? "paragraph" : id,
  );
}

/** Colour the whole block (the schema has one colour per block, kept with its background). */
export function colourBlock(
  actions: DocActions,
  block: Block,
  token: ColorToken | null,
  editor: Editor | null,
) {
  const rest: BlockStyle = { ...(block.style ?? {}) };
  delete rest.color;
  const next: BlockStyle | null = token
    ? { ...rest, color: token }
    : Object.keys(rest).length > 0
      ? rest
      : null;
  actions.perform(setStyle(actions.documentId, block.id, next), "Color");
  if (editor && !editor.isDestroyed) editor.commands.focus();
}
