import type { Block, BlockFlag, CitedText, RichText } from "@notes/schema";
import { type ReactNode, useEffect, useState } from "react";
import { RichTextView } from "../blocks/RichText";
import { useActions, useSignal, useView } from "../context";
import { type EditorLine, richTextSize } from "../model/richtext";
import { cx } from "../ui/primitives";
import { type EditorKeys, InlineEditor } from "./InlineEditor";
import type { LineKind } from "./lines";

/** Editor offset (atoms count one) of a point inside a static rich-text rendering. */
function offsetFromPoint(container: HTMLElement, x: number, y: number): number | null {
  const doc = container.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || !container.contains(node)) return null;
  let total = 0;
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const atom = (current.parentElement as HTMLElement | null)?.closest(".doc-cite, .doc-concept");
    if (current === node) {
      return total + (atom ? 0 : offset);
    }
    if (atom) {
      // An atom's text counts once, on its first text node.
      if (atom.firstChild === current || atom.textContent?.startsWith(current.textContent ?? ""))
        total += 1;
    } else total += current.textContent?.length ?? 0;
  }
  return total;
}

export interface RichFieldProps {
  blockId: string;
  /** Which field in the block, for focus requests ("main" for the main text). */
  field?: string;
  value: RichText;
  onCommit: (value: RichText) => void;
  block: Pick<Block, "citations">;
  cited?: Pick<CitedText, "citations"> | undefined;
  flags?: readonly BlockFlag[] | undefined;
  placeholder?: string;
  className?: string;
  label: string;
  keys?: EditorKeys;
  /** Read-only even in edit mode. */
  readOnly?: boolean;
  as?: "span" | "div" | "p";
}

/**
 * A piece of rich text that reads as static text and turns into a Tiptap
 * editor where she taps it (in edit mode). Only the field being edited holds
 * an editor, so a long document stays light.
 */
export function RichField({
  blockId,
  field = "main",
  value,
  onCommit,
  block,
  cited,
  flags,
  placeholder,
  className,
  label,
  keys,
  readOnly,
  as = "div",
}: RichFieldProps) {
  const { editing } = useView();
  const actions = useActions();
  const isActive = useSignal(actions.active, (id) => id === blockId);
  const request = useSignal(actions.focus, (req) =>
    req && req.blockId === blockId && req.field === field ? req : null,
  );
  const [mounted, setMounted] = useState<{ at: "start" | "end" | number } | null>(null);

  useEffect(() => {
    if (!request) return;
    setMounted({ at: request.at });
    actions.setActive(blockId);
    actions.focus.set(null);
  }, [request, actions, blockId]);

  useEffect(() => {
    if (!isActive) setMounted(null);
  }, [isActive]);

  useEffect(() => {
    if (!editing) setMounted(null);
  }, [editing]);

  const editable = editing && !readOnly;

  if (editable && mounted) {
    return (
      <InlineEditor
        mode="single"
        value={value}
        onCommit={(v) => onCommit(v as RichText)}
        block={block}
        field={cited}
        autoFocus={mounted.at}
        ariaLabel={label}
        placeholder={placeholder ?? "Type something…"}
        className={className}
        {...(keys ? { keys } : {})}
        testId={`editor-${field}`}
      />
    );
  }

  const view: ReactNode = (
    <RichTextView
      value={value}
      block={block}
      field={cited}
      flags={editing ? undefined : flags}
      as={as}
      className={className}
      {...(editable ? { placeholder: placeholder ?? "Type something…" } : {})}
    />
  );
  if (!editable) return view;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a static stand-in that becomes the editor on focus
    <div
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline="true"
      data-testid={`field-${field}`}
      className={cx("cursor-text rounded-md outline-none", !value.length && "min-h-[1.7em]")}
      onFocus={(event) => {
        if (event.target === event.currentTarget && !mounted) {
          actions.setActive(blockId);
          setMounted({ at: "end" });
        }
      }}
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest(".doc-cite, .doc-concept, a, .doc-flag")) return;
        const offset = offsetFromPoint(event.currentTarget, event.clientX, event.clientY);
        event.preventDefault();
        actions.setActive(blockId);
        setMounted({ at: offset ?? "end" });
      }}
    >
      {view}
    </div>
  );
}

export interface ListFieldProps {
  blockId: string;
  lines: EditorLine[];
  kind: LineKind;
  start?: number;
  block: Pick<Block, "citations">;
  onCommit: (lines: EditorLine[]) => void;
  keys?: EditorKeys;
  label: string;
  children: ReactNode;
}

/** A list or checklist: static lines that become one Tiptap editor where she taps. */
export function ListField({
  blockId,
  lines,
  kind,
  start,
  block,
  onCommit,
  keys,
  label,
  children,
}: ListFieldProps) {
  const { editing } = useView();
  const actions = useActions();
  const isActive = useSignal(actions.active, (id) => id === blockId);
  const request = useSignal(actions.focus, (req) => (req && req.blockId === blockId ? req : null));
  const [mounted, setMounted] = useState<{ at: "start" | "end" | number } | null>(null);

  useEffect(() => {
    if (!request) return;
    setMounted({ at: request.at });
    actions.setActive(blockId);
    actions.focus.set(null);
  }, [request, actions, blockId]);
  useEffect(() => {
    if (!isActive || !editing) setMounted(null);
  }, [isActive, editing]);

  if (editing && mounted) {
    return (
      <div className="doc-lines" data-kind={kind}>
        <InlineEditor
          mode="lines"
          lineKind={kind}
          {...(start !== undefined ? { start } : {})}
          value={lines}
          onCommit={(v) => onCommit(v as EditorLine[])}
          block={block}
          autoFocus={mounted.at}
          ariaLabel={label}
          {...(keys ? { keys } : {})}
          testId="editor-lines"
        />
      </div>
    );
  }
  if (!editing) return <>{children}</>;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a static stand-in that becomes the editor on focus
    <div
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline="true"
      data-testid="field-lines"
      className="cursor-text rounded-md outline-none"
      onFocus={(event) => {
        if (event.target === event.currentTarget && !mounted) {
          actions.setActive(blockId);
          setMounted({ at: "end" });
        }
      }}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".doc-cite, .doc-concept, a, .doc-check")) return;
        event.preventDefault();
        actions.setActive(blockId);
        const index = Number(
          target.closest<HTMLElement>("[data-line-index]")?.dataset.lineIndex ?? -1,
        );
        if (index < 0) {
          setMounted({ at: "end" });
          return;
        }
        // Editor position at the end of that line: each line adds its size plus 2.
        let pos = 0;
        for (let i = 0; i <= index; i++)
          pos += richTextSize(lines[i]?.text ?? []) + (i < index ? 2 : 0);
        setMounted({ at: pos });
      }}
    >
      {children}
    </div>
  );
}
