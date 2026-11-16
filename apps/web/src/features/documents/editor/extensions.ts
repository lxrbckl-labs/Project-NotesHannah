import { type Extensions, Mark, mergeAttributes, Node } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Paragraph from "@tiptap/extension-paragraph";
import Strike from "@tiptap/extension-strike";
import Text from "@tiptap/extension-text";
import Underline from "@tiptap/extension-underline";

/**
 * The Tiptap schema for a block's inline text: the schema's marks, citation
 * markers and concept mentions, nothing else. Blocks are not Tiptap nodes;
 * each text field gets its own small editor.
 */

export interface InlineNodeOptions {
  /** Chip text for marker n (the document-wide reference number). */
  citeLabel: (n: number) => string;
  onOpenCite: (n: number) => void;
  onOpenConcept: (id: string) => void;
}

export const CitationNode = Node.create<InlineNodeOptions>({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { citeLabel: (n) => String(n), onOpenCite: () => {}, onOpenConcept: () => {} };
  },
  addAttributes() {
    return {
      n: {
        default: 1,
        parseHTML: (el) => Number(el.getAttribute("data-cite")) || 1,
        renderHTML: (attrs) => ({ "data-cite": attrs.n }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-cite]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "doc-cite" }),
      String(HTMLAttributes["data-cite"]),
    ];
  },
  renderText({ node }) {
    return `[${node.attrs.n}]`;
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("button");
      dom.type = "button";
      dom.className = "doc-cite";
      dom.contentEditable = "false";
      dom.dataset.cite = String(node.attrs.n);
      const label = this.options.citeLabel(Number(node.attrs.n));
      dom.textContent = label;
      dom.setAttribute("aria-label", `Source ${label}`);
      dom.addEventListener("mousedown", (event) => event.preventDefault());
      dom.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.options.onOpenCite(Number(node.attrs.n));
      });
      return { dom, ignoreMutation: () => true };
    };
  },
});

export const ConceptNode = Node.create<InlineNodeOptions>({
  name: "concept",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { citeLabel: (n) => String(n), onOpenCite: () => {}, onOpenConcept: () => {} };
  },
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute("data-concept") },
      text: { default: "", parseHTML: (el) => el.textContent ?? "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-concept]" }];
  },
  renderHTML({ node }) {
    return ["span", { "data-concept": node.attrs.id, class: "doc-concept" }, node.attrs.text];
  },
  renderText({ node }) {
    return String(node.attrs.text);
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "doc-concept";
      dom.contentEditable = "false";
      dom.dataset.concept = String(node.attrs.id);
      dom.textContent = String(node.attrs.text);
      dom.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey) this.options.onOpenConcept(String(node.attrs.id));
      });
      return { dom, ignoreMutation: () => true };
    };
  },
});

/** Highlighter with a colour token, stored as the run's `highlight`. */
export const TokenHighlight = Mark.create({
  name: "highlight",
  addAttributes() {
    return {
      color: {
        default: "yellow",
        parseHTML: (el) => el.getAttribute("data-color") ?? "yellow",
        renderHTML: (attrs) => ({ "data-color": attrs.color }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "doc-hl" }), 0];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name, { color: "yellow" }),
    };
  },
});

/** Inline code that may combine with other marks (the schema allows bold code). */
const CodeMark = Code.extend({ excludes: "" });

/** Paragraphs carry a list indent and a checked state when they are list lines. */
const LineParagraph = Paragraph.extend({
  addAttributes() {
    return {
      indent: {
        default: 0,
        keepOnSplit: true,
        parseHTML: (el) => Number(el.getAttribute("data-indent") ?? 0),
        renderHTML: (attrs) => ({ "data-indent": attrs.indent }),
      },
      checked: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) =>
          el.hasAttribute("data-checked") ? el.getAttribute("data-checked") === "true" : null,
        renderHTML: (attrs) =>
          attrs.checked === null ? {} : { "data-checked": String(attrs.checked) },
      },
    };
  },
});

/** One paragraph only: headings, paragraphs, quotes, callouts, cells. */
export const SingleDocument = Document.extend({ content: "paragraph" });
/** One paragraph per item: lists and checklists. */
export const LinesDocument = Document.extend({ content: "paragraph+" });

export function inlineExtensions(
  mode: "single" | "lines",
  options: Partial<InlineNodeOptions> = {},
): Extensions {
  return [
    mode === "single" ? SingleDocument : LinesDocument,
    LineParagraph,
    Text,
    HardBreak.configure({ keepMarks: true }),
    Bold,
    Italic,
    Underline,
    Strike,
    CodeMark,
    TokenHighlight,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: [],
      defaultProtocol: "https",
      isAllowedUri: (url) => /^https?:\/\//i.test(url),
    }),
    CitationNode.configure(options),
    ConceptNode.configure(options),
  ];
}
