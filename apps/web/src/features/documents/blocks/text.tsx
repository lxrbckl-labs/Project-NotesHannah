import {
  type Block,
  type BlockOf,
  CALLOUT_DEFAULT_COLORS,
  type CalloutKind,
  newId,
  type RichText,
} from "@notes/schema";
import {
  BookMarked,
  CircleAlert,
  GraduationCap,
  Info,
  Lightbulb,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { type DocActions, useActions } from "../context";
import type { EditorKeys } from "../editor/InlineEditor";
import { RichField } from "../editor/RichField";
import {
  deleteBlocks,
  isListType,
  isTextType,
  mergeIntoPrevious,
  splitTextBlock,
  turnInto,
} from "../model/gestures";
import { richTextSize } from "../model/richtext";
import { toneVars } from "../ui/hooks";
import { cx } from "../ui/primitives";
import { PlainInput, useBlockEdit } from "./common";

/** Move the caret to the neighbouring editable block. */
export function focusNeighbour(
  actions: DocActions,
  blockId: string,
  direction: "up" | "down",
): boolean {
  const doc = actions.docRef.current;
  if (!doc) return false;
  const at = doc.blockIds.indexOf(blockId);
  const step = direction === "up" ? -1 : 1;
  for (let i = at + step; i >= 0 && i < doc.blocks.length; i += step) {
    const candidate = doc.blocks[i] as Block;
    if (isTextType(candidate.type) || isListType(candidate.type)) {
      actions.requestFocus(candidate.id, direction === "up" ? "end" : "start");
      return true;
    }
    if (candidate.type !== "divider") return false;
  }
  return false;
}

/** Enter, Backspace, arrows and "/" for a block whose main content is one piece of text. */
export function useTextKeys(block: Block): EditorKeys {
  const actions = useActions();
  return {
    onEnter: (before, after) => {
      const clientId = newId("block");
      const ok = actions.perform(
        splitTextBlock(actions.documentId, block, before, after, clientId),
        "Split",
      );
      if (ok) actions.requestFocus(clientId, "start");
      return ok;
    },
    onBackspaceStart: (current) => {
      const doc = actions.docRef.current;
      if (!doc) return false;
      const at = doc.blockIds.indexOf(block.id);
      const previous = at > 0 ? (doc.blocks[at - 1] as Block) : null;
      if (block.type !== "paragraph") {
        // Backspace at the start of a heading, quote or callout turns it into a paragraph first.
        const ok = actions.perform(
          turnInto(actions.documentId, block, "paragraph"),
          "Turn into paragraph",
        );
        if (ok) actions.requestFocus(block.id, "start");
        return ok;
      }
      if (current.length === 0) {
        const ok = actions.perform(deleteBlocks(actions.documentId, [block.id]), "Delete block");
        if (ok && previous) focusNeighbour(actions, block.id, "up");
        return ok;
      }
      if (!previous || !isTextType(previous.type)) return false;
      const calls = mergeIntoPrevious(actions.documentId, previous, block, current);
      if (!calls) return false;
      const offset = richTextSize((previous.content as { text: RichText }).text);
      const ok = actions.perform(calls, "Merge blocks");
      if (ok) actions.requestFocus(previous.id, offset);
      return ok;
    },
    onArrowOut: (direction) => focusNeighbour(actions, block.id, direction),
    onSlash: (query) => {
      if (query === null) actions.slashQuery.set(null);
      else actions.openInsertMenu(block.id, true, null, query);
    },
    slashKey: (key) => actions.slashKeyHandler.current?.(key) ?? false,
  };
}

function useTextCommit(block: Block) {
  const { patch } = useBlockEdit(block);
  return (text: RichText) => patch({ text }, "Edit text");
}

export function ParagraphBlock({ block }: { block: BlockOf<"paragraph"> }) {
  const keys = useTextKeys(block);
  const commit = useTextCommit(block);
  const color = block.style?.color;
  return (
    <RichField
      blockId={block.id}
      value={block.content.text}
      onCommit={commit}
      block={block}
      flags={block.flags}
      keys={keys}
      label="Paragraph"
      placeholder="Type, or press / for blocks"
      className={cx("min-h-[1.7em]", color && "text-[var(--t-fg)]")}
      as="p"
    />
  );
}

const HEADING_CLASS = {
  1: "text-[1.75rem] leading-tight font-bold tracking-[-0.015em] pointer-coarse:text-[1.65rem]",
  2: "text-[1.35rem] leading-snug font-semibold tracking-[-0.01em]",
  3: "text-[1.1rem] leading-snug font-semibold",
} as const;

export function HeadingBlock({ block }: { block: BlockOf<"heading"> }) {
  const keys = useTextKeys(block);
  const commit = useTextCommit(block);
  const level = block.content.level;
  const Tag = `h${level + 1}` as "h2" | "h3" | "h4";
  return (
    <Tag
      id={`h-${block.id}`}
      data-outline-heading={level}
      className={cx(
        HEADING_CLASS[level],
        "scroll-mt-24",
        block.style?.color && "text-[var(--t-fg)]",
      )}
    >
      <RichField
        blockId={block.id}
        value={block.content.text}
        onCommit={commit}
        block={block}
        flags={block.flags}
        keys={keys}
        label={`Heading ${level}`}
        placeholder={`Heading ${level}`}
        as="span"
      />
    </Tag>
  );
}

export function QuoteBlock({ block }: { block: BlockOf<"quote"> }) {
  const keys = useTextKeys(block);
  const commit = useTextCommit(block);
  const { editing, patch } = useBlockEdit(block);
  const tone = block.style?.color ?? "gray";
  return (
    <figure
      className="doc-tone my-1 border-l-[3px] border-[var(--t-solid)] py-1 pl-5"
      style={toneVars(tone)}
    >
      <blockquote className="font-serif text-[1.1em] leading-relaxed italic text-text">
        <RichField
          blockId={block.id}
          value={block.content.text}
          onCommit={commit}
          block={block}
          flags={block.flags}
          keys={keys}
          label="Quote"
          placeholder="Quote"
        />
      </blockquote>
      {(block.content.attribution || editing) && (
        <figcaption className="mt-1.5 text-[13.5px] text-text-muted">
          {editing ? (
            <span className="flex items-center gap-1">
              <span aria-hidden>—</span>
              <PlainInput
                value={block.content.attribution ?? ""}
                label="Who said it"
                placeholder="Who said it (optional)"
                onCommit={(attribution) =>
                  patch({ attribution: attribution || undefined }, "Edit attribution")
                }
              />
            </span>
          ) : (
            <>— {block.content.attribution}</>
          )}
        </figcaption>
      )}
    </figure>
  );
}

export const CALLOUT_META: Record<CalloutKind, { label: string; icon: ReactNode }> = {
  info: { label: "Info", icon: <Info className="size-[18px]" /> },
  tip: { label: "Tip", icon: <Lightbulb className="size-[18px]" /> },
  warning: { label: "Warning", icon: <TriangleAlert className="size-[18px]" /> },
  important: { label: "Important", icon: <CircleAlert className="size-[18px]" /> },
  definition: { label: "Definition", icon: <BookMarked className="size-[18px]" /> },
  exam_tip: { label: "Exam tip", icon: <GraduationCap className="size-[18px]" /> },
};

export function CalloutBlock({ block }: { block: BlockOf<"callout"> }) {
  const keys = useTextKeys(block);
  const commit = useTextCommit(block);
  const { editing, patch } = useBlockEdit(block);
  const kind = block.content.kind;
  const tone = block.style?.color ?? CALLOUT_DEFAULT_COLORS[kind];
  const background = block.style?.background;
  const meta = CALLOUT_META[kind];
  return (
    <aside
      aria-label={meta.label}
      data-kind={kind}
      className="doc-tone flex gap-3 rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-3.5"
      style={{
        ...toneVars(tone),
        ...(background ? { background: `var(--doc-${background}-bg)` } : {}),
      }}
    >
      <span
        aria-hidden
        className="mt-[3px] flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--t-hl)] text-[var(--t-fg)]"
      >
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        {(block.content.title || editing) && (
          <div className="mb-0.5 text-[15px] font-semibold text-[var(--t-fg)]">
            {editing ? (
              <PlainInput
                value={block.content.title ?? ""}
                label="Callout title"
                placeholder={meta.label}
                onCommit={(title) => patch({ title: title || undefined }, "Edit title")}
              />
            ) : (
              block.content.title
            )}
          </div>
        )}
        <RichField
          blockId={block.id}
          value={block.content.text}
          onCommit={commit}
          block={block}
          flags={block.flags}
          keys={keys}
          label={`${meta.label} text`}
          placeholder="Write the note…"
        />
      </div>
    </aside>
  );
}
