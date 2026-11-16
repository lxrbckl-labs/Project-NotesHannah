import { type Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** How a list draws its markers. */
export type LineKind = "bullet" | "number" | "check";

const BULLETS = ["•", "◦", "▪"];

function alpha(n: number): string {
  let out = "";
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    out = String.fromCharCode(97 + r) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
}

function roman(n: number): string {
  const table: Array<[number, string]> = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let v = n;
  for (const [value, sym] of table) {
    while (v >= value) {
      out += sym;
      v -= value;
    }
  }
  return out || String(n);
}

/** Marker text for each item: bullets by depth, or 1. / a. / i. numbering per level. */
export function listLabels(indents: readonly number[], kind: LineKind, start = 1): string[] {
  if (kind === "check") return indents.map(() => "");
  if (kind === "bullet") return indents.map((indent) => BULLETS[indent] ?? "•");
  const counters = [start - 1, 0, 0];
  return indents.map((indent) => {
    counters[indent] = (counters[indent] ?? 0) + 1;
    for (let deeper = indent + 1; deeper < counters.length; deeper++) counters[deeper] = 0;
    const n = counters[indent] as number;
    if (indent === 0) return `${n}.`;
    if (indent === 1) return `${alpha(n)}.`;
    return `${roman(n)}.`;
  });
}

/** The deepest list level the schema allows (indent 0, 1 and 2). */
export const MAX_INDENT = 2;

/**
 * Indent (+1) or outdent (-1) the list line the caret is on. A line goes at
 * most one level deeper than the line above it, so the list never skips a
 * level. Shared by Tab / Shift-Tab and the ribbon's indent buttons.
 */
export function changeIndent(editor: Editor, delta: number): boolean {
  const { $from } = editor.state.selection;
  const index = $from.index(0);
  const prev = index > 0 ? Number(editor.state.doc.child(index - 1).attrs.indent ?? 0) : -1;
  const now = Number($from.parent.attrs.indent ?? 0);
  const next = Math.max(0, Math.min(MAX_INDENT, prev + 1, now + delta));
  if (next === now) return true;
  return editor.commands.updateAttributes("paragraph", { indent: next });
}

/** What indent and outdent can do on the caret's line now, for the buttons' enabled state. */
export function indentRoom(editor: Editor): { indent: boolean; outdent: boolean } {
  const { $from } = editor.state.selection;
  if ($from.depth < 1) return { indent: false, outdent: false };
  const index = $from.index(0);
  const prev = index > 0 ? Number(editor.state.doc.child(index - 1).attrs.indent ?? 0) : -1;
  const now = Number($from.parent.attrs.indent ?? 0);
  return { indent: now < Math.min(MAX_INDENT, prev + 1), outdent: now > 0 };
}

/**
 * Draws list markers and checkboxes on the paragraphs of a list editor.
 * Paragraph attrs carry `indent` and `checked`; markers are decorations so
 * the stored text never contains them.
 */
export function listLinesExtension(kind: LineKind, start = 1) {
  const key = new PluginKey("doc-list-lines");
  return Extension.create({
    name: "docListLines",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key,
          props: {
            decorations(state) {
              const decorations: Decoration[] = [];
              const indents: number[] = [];
              state.doc.forEach((node) => {
                indents.push(Number(node.attrs.indent ?? 0));
              });
              const labels = listLabels(indents, kind, start);
              state.doc.forEach((node, pos, index) => {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "doc-line",
                    "data-label": labels[index] ?? "",
                    style: `--indent:${indents[index] ?? 0}`,
                  }),
                );
              });
              return DecorationSet.create(state.doc, decorations);
            },
            nodeViews:
              kind === "check"
                ? {
                    paragraph: (node, view, getPos) => {
                      const dom = document.createElement("div");
                      dom.className = "doc-line";
                      const box = document.createElement("button");
                      box.type = "button";
                      box.className = "doc-check";
                      box.contentEditable = "false";
                      box.setAttribute("role", "checkbox");
                      const content = document.createElement("span");
                      content.className = "doc-line-text";
                      dom.append(box, content);
                      let current = node;
                      const paint = () => {
                        const checked = Boolean(current.attrs.checked);
                        box.setAttribute("aria-checked", String(checked));
                        box.setAttribute("aria-label", checked ? "Mark not done" : "Mark done");
                        box.innerHTML = checked
                          ? '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                          : "";
                        dom.dataset.checked = String(checked);
                        dom.style.setProperty("--indent", String(current.attrs.indent ?? 0));
                      };
                      paint();
                      box.addEventListener("mousedown", (event) => event.preventDefault());
                      box.addEventListener("click", () => {
                        const pos = typeof getPos === "function" ? getPos() : undefined;
                        if (pos === undefined) return;
                        view.dispatch(
                          view.state.tr.setNodeMarkup(pos, undefined, {
                            ...current.attrs,
                            checked: !current.attrs.checked,
                          }),
                        );
                      });
                      return {
                        dom,
                        contentDOM: content,
                        update(next) {
                          if (next.type !== current.type) return false;
                          current = next;
                          paint();
                          return true;
                        },
                        ignoreMutation: (mutation) =>
                          mutation.type === "attributes" || box.contains(mutation.target as Node),
                      };
                    },
                  }
                : {},
          },
        }),
      ];
    },
  });
}
