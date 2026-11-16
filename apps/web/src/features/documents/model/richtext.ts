import {
  type ColorToken,
  type Inline,
  normalizeRichText,
  type RichText,
  type TextRun,
} from "@notes/schema";

/**
 * Converters between the schema's rich text (a flat list of inline items)
 * and Tiptap's JSON for the inline content of one block. Only the inline text
 * of a block lives in Tiptap; the block itself stays in the schema's format.
 *
 * - A text run becomes text nodes with marks; a newline becomes a hardBreak
 *   carrying the run's marks, so "a\nb" in bold round-trips as one run.
 * - `{ cite: n }` becomes an inline atom `citation` with `n`.
 * - `{ concept, text }` becomes an inline atom `concept` with `id` and `text`.
 */

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

const SIMPLE_MARKS = ["bold", "italic", "underline", "strike", "code"] as const;

function marksOf(run: TextRun): TiptapMark[] {
  const marks: TiptapMark[] = [];
  for (const key of SIMPLE_MARKS) if (run[key]) marks.push({ type: key });
  if (run.highlight) marks.push({ type: "highlight", attrs: { color: run.highlight } });
  if (run.link) marks.push({ type: "link", attrs: { href: run.link } });
  return marks;
}

function withMarks(node: TiptapNode, marks: TiptapMark[]): TiptapNode {
  return marks.length > 0 ? { ...node, marks } : node;
}

/** Schema rich text → Tiptap inline nodes. */
export function richTextToInline(value: RichText | string): TiptapNode[] {
  const items = normalizeRichText(value);
  const out: TiptapNode[] = [];
  for (const item of items) {
    if ("cite" in item) {
      out.push({ type: "citation", attrs: { n: item.cite } });
    } else if ("concept" in item) {
      out.push({ type: "concept", attrs: { id: item.concept, text: item.text } });
    } else {
      const marks = marksOf(item);
      const pieces = item.text.split("\n");
      pieces.forEach((piece, i) => {
        if (i > 0) out.push(withMarks({ type: "hardBreak" }, marks));
        if (piece.length > 0) out.push(withMarks({ type: "text", text: piece }, marks));
      });
    }
  }
  return out;
}

function runFromMarks(text: string, marks: TiptapMark[] | undefined): TextRun {
  const run: TextRun = { text };
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
      case "italic":
      case "underline":
      case "strike":
      case "code":
        run[mark.type] = true;
        break;
      case "highlight": {
        const color = mark.attrs?.color;
        if (typeof color === "string") run.highlight = color as ColorToken;
        break;
      }
      case "link": {
        const href = mark.attrs?.href;
        if (typeof href === "string" && /^https?:\/\//i.test(href)) run.link = href;
        break;
      }
    }
  }
  return run;
}

/** Tiptap inline nodes → schema rich text (normalised). Unknown nodes are dropped. */
export function inlineToRichText(nodes: readonly TiptapNode[] | undefined): RichText {
  const items: Inline[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "text" && node.text) items.push(runFromMarks(node.text, node.marks));
    else if (node.type === "hardBreak") items.push(runFromMarks("\n", node.marks));
    else if (node.type === "citation") {
      const n = Number(node.attrs?.n);
      if (Number.isInteger(n) && n >= 1) items.push({ cite: n });
    } else if (node.type === "concept") {
      const id = node.attrs?.id;
      const text = node.attrs?.text;
      if (typeof id === "string" && typeof text === "string" && text.length > 0)
        items.push({ concept: id, text });
    }
  }
  return normalizeRichText(items);
}

/** A single-paragraph Tiptap document holding one piece of rich text. */
export function richTextToDoc(value: RichText | string): TiptapNode {
  const content = richTextToInline(value);
  return {
    type: "doc",
    content: [content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" }],
  };
}

/** Rich text from a single-paragraph document (extra paragraphs join with a newline). */
export function docToRichText(doc: TiptapNode): RichText {
  const paragraphs = doc.content ?? [];
  const items: Inline[] = [];
  paragraphs.forEach((paragraph, i) => {
    if (i > 0) items.push({ text: "\n" });
    items.push(...inlineToRichText(paragraph.content));
  });
  return normalizeRichText(items);
}

/** A line of a list or checklist as the editor holds it. */
export interface EditorLine {
  text: RichText;
  indent: number;
  checked?: boolean;
}

/** List lines → a Tiptap document with one paragraph per item. */
export function linesToDoc(lines: readonly EditorLine[]): TiptapNode {
  return {
    type: "doc",
    content: lines.map((line) => {
      const content = richTextToInline(line.text);
      const attrs: Record<string, unknown> = { indent: line.indent };
      if (line.checked !== undefined) attrs.checked = line.checked;
      return content.length > 0
        ? { type: "paragraph", attrs, content }
        : { type: "paragraph", attrs };
    }),
  };
}

/** A Tiptap list document → lines, with indents clamped so each grows by at most one. */
export function docToLines(doc: TiptapNode, withChecked: boolean): EditorLine[] {
  let previous = -1;
  return (doc.content ?? []).map((paragraph) => {
    const raw = Number(paragraph.attrs?.indent ?? 0);
    const indent = Math.max(0, Math.min(2, previous + 1, Number.isFinite(raw) ? raw : 0));
    previous = indent;
    const line: EditorLine = { text: inlineToRichText(paragraph.content), indent };
    if (withChecked) line.checked = Boolean(paragraph.attrs?.checked);
    return line;
  });
}

/** Number of characters an item occupies in the editor: text length, 1 for atoms. */
function inlineSize(item: Inline): number {
  if ("cite" in item) return 1;
  if ("concept" in item) return 1;
  return item.text.length;
}

/** Length of rich text in editor positions (atoms count 1). */
export function richTextSize(value: RichText): number {
  return value.reduce((sum, item) => sum + inlineSize(item), 0);
}

/**
 * Split rich text at an editor offset (atoms count as one position):
 * used when Enter splits a block in two.
 */
export function splitRichText(value: RichText, offset: number): [RichText, RichText] {
  const before: Inline[] = [];
  const after: Inline[] = [];
  let at = 0;
  for (const item of value) {
    const size = inlineSize(item);
    if (at + size <= offset) before.push(item);
    else if (at >= offset) after.push(item);
    else if ("text" in item && !("concept" in item)) {
      const cut = offset - at;
      before.push({ ...item, text: item.text.slice(0, cut) });
      after.push({ ...item, text: item.text.slice(cut) });
    } else {
      after.push(item);
    }
    at += size;
  }
  return [normalizeRichText(before), normalizeRichText(after)];
}

/** Join two pieces of rich text (merging blocks on Backspace). */
export function joinRichText(a: RichText, b: RichText): RichText {
  return normalizeRichText([...a, ...b]);
}

/** Shift citation markers by `by` (when text joins a block whose citations come first). */
export function shiftCitations(value: RichText, by: number): RichText {
  if (by === 0) return value;
  return value.map((item) => ("cite" in item ? { cite: item.cite + by } : item));
}
