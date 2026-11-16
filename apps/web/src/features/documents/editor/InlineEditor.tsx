import type { Block, CitedText, RichText } from "@notes/schema";
import { type Editor, Extension } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "../../../lib/cn";
import { useActions, useView } from "../context";
import { markerCitation } from "../model/references";
import {
  docToLines,
  docToRichText,
  type EditorLine,
  linesToDoc,
  richTextToDoc,
  splitRichText,
  type TiptapNode,
} from "../model/richtext";
import { SHORTCUT_PREFIX } from "../model/shortcuts";
import { inlineExtensions } from "./extensions";
import { changeIndent, type LineKind, listLinesExtension } from "./lines";

/** Keys the surrounding block handles (splitting, merging, moving between blocks). */
export interface EditorKeys {
  /** Enter in a single-line field: return true when handled (the block split). */
  onEnter?: (before: RichText, after: RichText) => boolean;
  /** Backspace with the cursor at the very start. */
  onBackspaceStart?: (current: RichText) => boolean;
  /** Arrow up at the start or down at the end: move to the neighbouring block. */
  onArrowOut?: (direction: "up" | "down") => boolean;
  /** Lists: Enter on an empty last line leaves the list. */
  onExitList?: (lines: EditorLine[]) => void;
  /** Lists: Backspace in the only, empty line. */
  onEmptyList?: () => void;
  /**
   * A typing shortcut completed at the very start of the field ("#" and a space):
   * `trigger` is what was typed before the space, `rest` the text after it. Return
   * true when the block converted (the editor then goes away with its old block).
   */
  onShortcut?: (trigger: string, rest: RichText) => boolean;
  /** "/" typed at the start of an otherwise empty field; null when it goes away. */
  onSlash?: (query: string | null) => void;
  /** While the slash menu is open, it gets first go at arrow keys, Enter and Escape. */
  slashKey?: (key: string) => boolean;
}

export type EditorValue = RichText | EditorLine[];

export interface InlineEditorProps {
  /** The block this text belongs to, so the ribbon knows what the caret is in. */
  blockId?: string;
  mode: "single" | "lines";
  value: EditorValue;
  lineKind?: LineKind;
  start?: number;
  onCommit: (value: EditorValue) => void;
  block: Pick<Block, "citations">;
  field?: Pick<CitedText, "citations"> | undefined;
  autoFocus?: "start" | "end" | number | null;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  keys?: EditorKeys;
  onFocusChange?: (focused: boolean) => void;
  /** Commit after this long without typing. */
  debounceMs?: number;
  testId?: string;
}

/** Key names for Tiptap shortcuts (kept out of object literals so lint does not read them as components). */
const KEY = {
  escape: "Escape",
  down: "ArrowDown",
  up: "ArrowUp",
  tab: "Tab",
  enter: "Enter",
  backspace: "Backspace",
} as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function readValue(editor: Editor, mode: "single" | "lines", lineKind?: LineKind): EditorValue {
  const json = editor.getJSON() as TiptapNode;
  return mode === "single" ? docToRichText(json) : docToLines(json, lineKind === "check");
}

function toDoc(value: EditorValue, mode: "single" | "lines"): TiptapNode {
  return mode === "single" ? richTextToDoc(value as RichText) : linesToDoc(value as EditorLine[]);
}

/**
 * A Tiptap editor for one piece of a block's text. It holds the schema's
 * rich text, commits it (debounced, and on blur) as the block's content, and
 * hands Enter/Backspace at the edges to the block so blocks split and merge.
 */
export function InlineEditor(props: InlineEditorProps) {
  const { mode, lineKind, start, autoFocus, placeholder, ariaLabel, debounceMs = 450 } = props;
  const actions = useActions();
  const { refs } = useView();
  const committed = useRef<EditorValue>(props.value);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const slashOpen = useRef(false);
  const lastValue = useRef<EditorValue>(props.value);

  const flushRef = useRef<() => void>(() => {});

  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor is built once per mount; later props are read through refs
  const extensions = useMemo(() => {
    const keymap = Extension.create({
      name: "docBlockKeys",
      priority: 1000,
      addKeyboardShortcuts() {
        const editor = this.editor;
        const keys = () => latest.current.keys ?? {};
        const slash = (key: string) => slashOpen.current && Boolean(keys().slashKey?.(key));
        // Read a pending DOM selection change first (e.g. ⌘↓ just before Enter).
        const sync = () =>
          (
            editor.view as unknown as { domObserver?: { flush?: () => void } }
          ).domObserver?.flush?.();
        const atStart = () => {
          sync();
          const { selection } = editor.state;
          return (
            selection.empty && selection.$from.parentOffset === 0 && selection.$from.index(0) === 0
          );
        };
        const atEnd = () => {
          sync();
          const { selection, doc } = editor.state;
          return selection.empty && selection.from >= doc.content.size - 1;
        };
        const currentLine = () => editor.state.selection.$from.parent;
        const setIndent = (delta: number) => changeIndent(editor, delta);
        const undo = () => {
          flushRef.current();
          actions.controller.undo();
          return true;
        };
        const redo = () => {
          flushRef.current();
          actions.controller.redo();
          return true;
        };
        const shortcuts: Record<string, () => boolean> = {
          "Mod-z": undo,
          "Mod-Shift-z": redo,
          "Mod-y": redo,
          [KEY.escape]: () => {
            if (slash("Escape")) return true;
            editor.commands.blur();
            return true;
          },
          [KEY.down]: () => {
            if (slash("ArrowDown")) return true;
            return atEnd() ? Boolean(keys().onArrowOut?.("down")) : false;
          },
          [KEY.up]: () => {
            if (slash("ArrowUp")) return true;
            return atStart() ? Boolean(keys().onArrowOut?.("up")) : false;
          },
          [KEY.tab]: () => (mode === "lines" ? lineKind === "check" || setIndent(1) : false),
          "Shift-Tab": () => (mode === "lines" ? lineKind === "check" || setIndent(-1) : false),
          [KEY.enter]: () => {
            if (slash("Enter")) return true;
            sync();
            if (mode === "single") {
              if (!editor.state.selection.empty) editor.commands.deleteSelection();
              const offset = editor.state.selection.$from.parentOffset;
              const value = docToRichText(editor.getJSON() as TiptapNode);
              const [before, after] = splitRichText(value, offset);
              const handled = Boolean(keys().onEnter?.(before, after));
              if (handled) {
                if (timer.current) clearTimeout(timer.current);
                dirty.current = false;
                committed.current = before;
              }
              return true;
            }
            const line = currentLine();
            if (line.content.size === 0) {
              const indent = Number(line.attrs.indent ?? 0);
              if (indent > 0) return setIndent(-1);
              const doc = editor.state.doc;
              const isLast = editor.state.selection.$from.index(0) === doc.childCount - 1;
              if (isLast && doc.childCount > 1 && keys().onExitList) {
                const lines = docToLines(
                  editor.getJSON() as TiptapNode,
                  lineKind === "check",
                ).slice(0, -1);
                if (timer.current) clearTimeout(timer.current);
                dirty.current = false;
                committed.current = lines;
                keys().onExitList?.(lines);
                return true;
              }
            }
            return false;
          },
          [KEY.backspace]: () => {
            if (mode === "lines") {
              const { selection, doc } = editor.state;
              if (selection.empty && selection.$from.parentOffset === 0) {
                const indent = Number(selection.$from.parent.attrs.indent ?? 0);
                if (indent > 0) return setIndent(-1);
                if (doc.childCount === 1 && doc.textContent === "" && keys().onEmptyList) {
                  keys().onEmptyList?.();
                  return true;
                }
              }
              return false;
            }
            if (!atStart()) return false;
            const value = docToRichText(editor.getJSON() as TiptapNode);
            const handled = Boolean(keys().onBackspaceStart?.(value));
            if (handled) {
              if (timer.current) clearTimeout(timer.current);
              dirty.current = false;
            }
            return handled;
          },
        };
        return shortcuts;
      },
    });
    const list = mode === "lines" ? [listLinesExtension(lineKind ?? "bullet", start)] : [];
    return [
      ...inlineExtensions(mode, {
        citeLabel: (n) => {
          const p = latest.current;
          const citation = markerCitation(p.block, p.field, n);
          return citation ? String(refsRef.current.numberOf(citation) || "?") : "?";
        },
        onOpenCite: (n) => {
          const p = latest.current;
          const citation = markerCitation(p.block, p.field, n);
          const number = citation ? refsRef.current.numberOf(citation) : 0;
          if (number) actions.openCitation(number);
        },
        onOpenConcept: (id) => actions.openConcept(id),
      }),
      ...(mode === "single" && placeholder
        ? [Placeholder.configure({ placeholder, showOnlyCurrent: false })]
        : []),
      keymap,
      ...list,
    ];
  }, []);

  const editor = useEditor({
    extensions,
    content: toDoc(props.value, mode),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    // Tiptap's base styles are in documents.css: the server's policy (style-src 'self') refuses a <style> element.
    injectCSS: false,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        role: "textbox",
        "aria-multiline": "true",
        class: cn(mode === "lines" && "doc-lines-editor"),
        ...(props.testId ? { "data-testid": props.testId } : {}),
      },
    },
    onUpdate: ({ editor }) => {
      dirty.current = true;
      // Kept current so a flush still has the text after the editor is destroyed.
      lastValue.current = readValue(editor, mode, lineKind);
      if (mode === "single" && latest.current.keys?.onShortcut && !slashOpen.current) {
        const { selection } = editor.state;
        const caret = selection.$from.parentOffset;
        const before = selection.$from.parent.textBetween(0, caret);
        // Chips count one position but no text, so a differing length means one sits in the prefix.
        if (selection.empty && before.length === caret && SHORTCUT_PREFIX.test(before)) {
          const [, rest] = splitRichText(docToRichText(editor.getJSON() as TiptapNode), caret);
          const trigger = before.trimEnd();
          // Commit the typed text first, so undo brings the paragraph back with its trigger.
          flushRef.current();
          // Out of this transaction: converting swaps the block's component and unmounts this editor.
          queueMicrotask(() => {
            if (!editor.isDestroyed) latest.current.keys?.onShortcut?.(trigger, rest);
          });
          return;
        }
      }
      if (mode === "single") {
        const text = editor.state.doc.textContent;
        const onlyText = editor.state.doc.firstChild?.childCount === 1 || text === "";
        const query =
          onlyText && text.startsWith("/") && !text.includes(" ") ? text.slice(1) : null;
        if (query !== null || slashOpen.current) {
          slashOpen.current = query !== null;
          latest.current.keys?.onSlash?.(query);
        }
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flushRef.current(), debounceMs);
    },
    onFocus: ({ editor }) => {
      actions.activeEditor.set(editor);
      // The ribbon keeps acting on this editor while a menu of its own has the focus.
      const blockId = latest.current.blockId;
      if (blockId && actions.caretEditor.get()?.editor !== editor)
        actions.caretEditor.set({ editor, blockId });
      latest.current.onFocusChange?.(true);
    },
    onBlur: ({ editor }) => {
      flushRef.current();
      setTimeout(() => {
        if (actions.activeEditor.get() === editor && !editor.isFocused)
          actions.activeEditor.set(null);
      }, 150);
      latest.current.onFocusChange?.(false);
    },
  });

  flushRef.current = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    if (slashOpen.current) return;
    const value = lastValue.current;
    if (same(value, committed.current)) return;
    committed.current = value;
    latest.current.onCommit(value);
  };

  // Register with the controller so undo and restore see unsaved typing.
  useEffect(() => actions.controller.registerFlush(() => flushRef.current()), [actions.controller]);

  // Flush on unmount.
  useEffect(
    () => () => {
      flushRef.current();
      if (editor && actions.activeEditor.get() === editor) actions.activeEditor.set(null);
      if (editor && actions.caretEditor.get()?.editor === editor) actions.caretEditor.set(null);
    },
    [editor, actions.activeEditor, actions.caretEditor],
  );

  // Take in outside changes (undo, another device) when she is not mid-typing.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (same(props.value, committed.current)) return;
    committed.current = props.value;
    if (dirty.current) return;
    if (same(readValue(editor, mode, lineKind), props.value)) return;
    const { from } = editor.state.selection;
    editor.commands.setContent(toDoc(props.value, mode), { emitUpdate: false });
    const max = editor.state.doc.content.size - 1;
    if (editor.isFocused) editor.commands.setTextSelection(Math.max(1, Math.min(from, max)));
  }, [editor, props.value, mode, lineKind]);

  // Focus where asked when mounted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount
  useEffect(() => {
    if (!editor || autoFocus == null) return;
    const at =
      typeof autoFocus === "number"
        ? Math.min(autoFocus + 1, editor.state.doc.content.size - 1)
        : autoFocus;
    // At once and without Tiptap's focus command, which re-applies the selection a frame
    // later: keys pressed right after the tap must not have the caret jump back.
    if (editor.isDestroyed || editor.isFocused) return;
    const size = editor.state.doc.content.size;
    const pos = at === "start" ? 1 : at === "end" ? size - 1 : Math.max(1, Math.min(at, size - 1));
    editor.commands.setTextSelection(pos);
    editor.view.focus();
    editor.commands.scrollIntoView();
  }, [editor]);

  return <EditorContent editor={editor} className={props.className} />;
}
