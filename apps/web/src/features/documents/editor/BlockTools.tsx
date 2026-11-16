import type { Block } from "@notes/schema";
import {
  BookMarked,
  IndentDecrease,
  IndentIncrease,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Table,
} from "lucide-react";
import type { ReactNode } from "react";
import { type DocActions, useActions } from "../context";
import { canRestyle } from "../model/blockStyle";
import { insertBlock, newBlockInput } from "../model/gestures";
import { type CaretTarget, toggleList } from "./caret";
import { changeIndent } from "./lines";
import { SHIFT, ToolButton } from "./tools";

/**
 * Block-level actions for the ribbon and the phone dock: list toggles,
 * indent and outdent, and one-tap inserts. Each is plain data, so the ribbon
 * can show it as a button or, when space runs out, as an item in "More".
 */
export interface ToolAction {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  run: () => void;
}

/** The block new things go after: the caret's, else the selected one, else the last. */
export function anchorBlockId(actions: DocActions, block: Block | null): string | null {
  if (block) return block.id;
  const active = actions.active.get();
  if (active) return active;
  const ids = actions.docRef.current?.blockIds ?? [];
  return ids[ids.length - 1] ?? null;
}

const isEmptyParagraph = (block: Block | null) =>
  block?.type === "paragraph" && block.content.text.length === 0;

export function useListActions(target: CaretTarget): ToolAction[] {
  const actions = useActions();
  const { editor, block } = target;
  const off = !editor || !block || !canRestyle(block);
  const list = (
    id: "bulleted_list" | "numbered_list" | "checklist",
    label: string,
    icon: ReactNode,
  ): ToolAction => ({
    id,
    label,
    icon,
    pressed: block?.type === id,
    disabled: off,
    run: () => {
      if (editor && block && !editor.isDestroyed) toggleList(actions, editor, block, id);
    },
  });
  return [
    list("bulleted_list", "Bulleted list", <List />),
    list("numbered_list", "Numbered list", <ListOrdered />),
    list("checklist", "Checklist", <ListTodo />),
  ];
}

export function useIndentActions(target: CaretTarget): ToolAction[] {
  const { editor, block, lines } = target;
  // Checklists are flat in the schema; only bulleted and numbered lists nest.
  const nests = lines && (block?.type === "bulleted_list" || block?.type === "numbered_list");
  const step = (delta: number) => () => {
    if (!editor || editor.isDestroyed) return;
    changeIndent(editor, delta);
    if (!editor.isFocused) editor.commands.focus();
  };
  return [
    {
      id: "outdent",
      label: "Outdent",
      icon: <IndentDecrease />,
      shortcut: `${SHIFT}Tab`,
      disabled: !nests || !target.outdent,
      run: step(-1),
    },
    {
      id: "indent",
      label: "Indent",
      icon: <IndentIncrease />,
      shortcut: "Tab",
      disabled: !nests || !target.indent,
      run: step(1),
    },
  ];
}

/** The two or three blocks she adds most, one tap each. */
export function useQuickInserts(target: CaretTarget): ToolAction[] {
  const actions = useActions();
  const { editor, block } = target;
  const anchor = () => anchorBlockId(actions, block);
  return [
    {
      id: "insert-table",
      label: "Insert table",
      icon: <Table />,
      run: () => actions.insertType("table", anchor(), isEmptyParagraph(block)),
    },
    {
      id: "insert-callout",
      label: "Insert callout",
      icon: <BookMarked />,
      run: () => actions.insertType("callout", anchor(), isEmptyParagraph(block)),
    },
    {
      id: "insert-divider",
      label: "Insert divider",
      icon: <Minus />,
      run: () => {
        // A divider holds no text: it goes after the block and the caret stays where it was.
        actions.perform(
          insertBlock(actions.documentId, anchor(), newBlockInput("divider")),
          "Insert block",
        );
        if (editor && !editor.isDestroyed) editor.commands.focus();
      },
    },
  ];
}

/** Toolbar buttons for a list of actions. */
export function ActionButtons({
  items,
  tooltips = true,
}: {
  items: ToolAction[];
  tooltips?: boolean;
}) {
  return items.map((item) => (
    <ToolButton
      key={item.id}
      label={item.label}
      {...(item.shortcut ? { shortcut: item.shortcut } : {})}
      {...(item.pressed !== undefined ? { active: item.pressed } : {})}
      {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
      onPress={item.run}
      tooltips={tooltips}
      testId={`tool-${item.id}`}
    >
      {item.icon}
    </ToolButton>
  ));
}
