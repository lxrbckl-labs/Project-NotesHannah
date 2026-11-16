import { type BlockOf, newId } from "@notes/schema";
import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import { type LineKind, listLabels } from "../editor/lines";
import { ListField } from "../editor/RichField";
import { deleteBlocks, insertBlock, newBlockInput, patchContent } from "../model/gestures";
import type { EditorLine } from "../model/richtext";
import { useBlockEdit } from "./common";
import { RichTextView } from "./RichText";
import { focusNeighbour } from "./text";

type ListBlock = BlockOf<"bulleted_list"> | BlockOf<"numbered_list"> | BlockOf<"checklist">;

function kindOf(block: ListBlock): LineKind {
  return block.type === "checklist"
    ? "check"
    : block.type === "numbered_list"
      ? "number"
      : "bullet";
}

function linesOf(block: ListBlock): EditorLine[] {
  if (block.type === "checklist")
    return block.content.items.map((item) => ({
      text: item.text,
      indent: 0,
      checked: item.checked,
    }));
  return block.content.items.map((item) => ({ text: item.text, indent: item.indent }));
}

function itemsOf(block: ListBlock, lines: EditorLine[]) {
  const safe = lines.length > 0 ? lines : [{ text: [], indent: 0, checked: false }];
  return block.type === "checklist"
    ? safe.map((line) => ({ text: line.text, checked: Boolean(line.checked) }))
    : safe.map((line) => ({ text: line.text, indent: line.indent }));
}

export function ListBlockView({ block }: { block: ListBlock }) {
  const { actions, patch } = useBlockEdit(block);
  const kind = kindOf(block);
  const lines = linesOf(block);
  const start = block.type === "numbered_list" ? (block.content.start ?? 1) : 1;
  const labels = listLabels(
    lines.map((l) => l.indent),
    kind,
    start,
  );
  const commit = (next: EditorLine[]) => patch({ items: itemsOf(block, next) }, "Edit list");
  const toggle = (index: number) => {
    if (block.type !== "checklist") return;
    const items = block.content.items.map((item, i) =>
      i === index ? { ...item, checked: !item.checked } : item,
    );
    patch({ items }, items[index]?.checked ? "Tick off" : "Untick");
  };
  const ListTag = kind === "number" ? "ol" : "ul";
  return (
    <ListField
      blockId={block.id}
      lines={lines}
      kind={kind}
      start={start}
      block={block}
      onCommit={commit}
      label={kind === "check" ? "Checklist" : "List"}
      keys={{
        onExitList: (rest) => {
          const clientId = newId("block");
          const ok = actions.perform(
            [
              ...patchContent(actions.documentId, block.id, { items: itemsOf(block, rest) }),
              ...insertBlock(actions.documentId, block.id, newBlockInput("paragraph"), clientId),
            ],
            "New paragraph",
          );
          if (ok) actions.requestFocus(clientId, "start");
        },
        onEmptyList: () => {
          const ok = actions.perform(deleteBlocks(actions.documentId, [block.id]), "Delete list");
          if (ok) focusNeighbour(actions, block.id, "up");
        },
        onArrowOut: (direction) => focusNeighbour(actions, block.id, direction),
      }}
    >
      <ListTag className="doc-lines m-0 list-none p-0" data-kind={kind}>
        {lines.map((line, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: list items have no IDs; position is their identity
            key={i}
            className="doc-line"
            data-line-index={i}
            data-label={labels[i]}
            data-checked={kind === "check" ? String(Boolean(line.checked)) : undefined}
            style={{ "--indent": line.indent } as CSSProperties}
          >
            {kind === "check" && (
              // biome-ignore lint/a11y/useSemanticElements: a styled checkbox that toggles in place
              <button
                type="button"
                role="checkbox"
                aria-checked={Boolean(line.checked)}
                aria-label={line.checked ? "Mark not done" : "Mark done"}
                className="doc-check"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(i);
                }}
              >
                {line.checked && <Check aria-hidden strokeWidth={3} className="size-3" />}
              </button>
            )}
            <RichTextView
              value={line.text}
              block={block}
              flags={block.flags}
              className="doc-line-text"
              placeholder="List item"
            />
          </li>
        ))}
      </ListTag>
    </ListField>
  );
}
