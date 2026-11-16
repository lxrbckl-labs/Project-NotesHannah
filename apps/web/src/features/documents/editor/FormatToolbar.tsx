import type { Block } from "@notes/schema";
import { useEditorState } from "@tiptap/react";
import { Redo2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../components/ui/button";
import { useActions, useSignal } from "../context";
import { useKeyboardInset } from "../ui/hooks";
import { BlockStyleMenu } from "./BlockStyleMenu";
import { ActionButtons, useIndentActions, useListActions } from "./BlockTools";
import { useCaretTarget } from "./caret";
import {
  Divider,
  HighlightPicker,
  keepCaret,
  LinkPicker,
  MarkButtons,
  ToolButton,
  useMarks,
} from "./tools";

/**
 * The selection bubble on a computer: inline marks, highlight and link over
 * selected words. The ribbon has the rest; this stays small, as in AFFiNE.
 */
export function SelectionBubble() {
  const actions = useActions();
  const editor = useSignal(actions.activeEditor, (e) => e);
  const marks = useMarks(editor);
  const selection = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor;
      if (!e) return null;
      const { from, to, empty } = e.state.selection;
      return { from, to, empty };
    },
  });
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed || !selection || selection.empty) {
      setPos(null);
      return;
    }
    try {
      const start = editor.view.coordsAtPos(selection.from);
      const end = editor.view.coordsAtPos(selection.to);
      const width = 330;
      const left = Math.max(
        8,
        Math.min((start.left + end.left) / 2 - width / 2, window.innerWidth - width - 8),
      );
      const top = start.top - 52 < 8 ? end.bottom + 8 : start.top - 52;
      setPos({ top, left });
    } catch {
      setPos(null);
    }
  }, [editor, selection]);

  useEffect(() => {
    if (!editor) setPos(null);
  }, [editor]);

  if (!editor || editor.isDestroyed || !pos) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label="Text formatting"
      data-testid="format-toolbar"
      className="anim-pop fixed z-(--z-dock) flex items-center gap-0.5 rounded-card border border-border bg-surface p-1 text-text shadow-pop"
      style={{ top: pos.top, left: pos.left }}
    >
      <MarkButtons editor={editor} marks={marks} />
      <Divider />
      <HighlightPicker editor={editor} current={marks.highlight} />
      <LinkPicker editor={editor} current={marks.link} />
    </div>,
    document.body,
  );
}

/**
 * The phone's formatting bar, docked above the on-screen keyboard while she
 * types: block style, marks, highlight, link, lists and indent, undo and
 * Done. It scrolls sideways.
 */
export function KeyboardDock({ blocks }: { blocks: readonly Block[] }) {
  const actions = useActions();
  const inset = useKeyboardInset();
  const target = useCaretTarget(blocks);
  const { editor } = target;
  const marks = useMarks(editor);
  const lists = useListActions(target);
  const indents = useIndentActions(target);
  // A menu or the link field takes the focus for a moment: the dock stays up meanwhile.
  const [holding, setHolding] = useState(false);

  if (!editor || (!target.focused && !holding)) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label="Text formatting"
      data-testid="format-toolbar"
      className="fixed inset-x-0 z-(--z-dock) flex items-center gap-0.5 overflow-x-auto border-t border-border bg-(--color-chrome) px-2 py-1 pb-[max(4px,env(safe-area-inset-bottom))] text-text shadow-pop backdrop-blur"
      style={{ bottom: inset }}
    >
      <BlockStyleMenu target={target} compact side="top" onOpenChange={setHolding} />
      <Divider />
      <MarkButtons editor={editor} marks={marks} tooltips={false} />
      <HighlightPicker editor={editor} current={marks.highlight} side="top" tooltips={false} />
      <LinkPicker
        editor={editor}
        current={marks.link}
        side="top"
        tooltips={false}
        onOpenChange={setHolding}
      />
      <Divider />
      <ActionButtons items={lists} tooltips={false} />
      <ActionButtons items={indents} tooltips={false} />
      <Divider />
      <ToolButton label="Undo" tooltips={false} onPress={() => actions.controller.undo()}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" tooltips={false} onPress={() => actions.controller.redo()}>
        <Redo2 />
      </ToolButton>
      <Button
        variant="ghostAccent"
        onMouseDown={keepCaret}
        onClick={() => editor.commands.blur()}
        className="ml-auto shrink-0 font-semibold"
      >
        Done
      </Button>
    </div>,
    document.body,
  );
}
