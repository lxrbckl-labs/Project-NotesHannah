import { Extension } from "@tiptap/core";
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
