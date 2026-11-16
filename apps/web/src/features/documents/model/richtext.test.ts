import { normalizeRichText, type RichText } from "@notes/schema";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { inlineExtensions } from "../editor/extensions";
import {
  docToLines,
  docToRichText,
  inlineToRichText,
  joinRichText,
  linesToDoc,
  richTextToDoc,
  richTextToInline,
  shiftCitations,
  splitRichText,
  type TiptapNode,
} from "./richtext";

const single = getSchema(inlineExtensions("single"));
const lines = getSchema(inlineExtensions("lines"));

/** Through ProseMirror itself, so the schema (marks, atoms, attrs) is really exercised. */
function throughEditor(value: RichText): RichText {
  const node = PMNode.fromJSON(single, richTextToDoc(value));
  node.check();
  return docToRichText(node.toJSON() as TiptapNode);
}

const CONCEPT = "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";

describe("rich text ↔ Tiptap", () => {
  const cases: Array<[string, RichText]> = [
    ["plain", [{ text: "Beta blockers end in -olol" }]],
    ["bold", [{ text: "Metoprolol", bold: true }]],
    ["italic", [{ text: "preferentially", italic: true }]],
    ["underline", [{ text: "never", underline: true }]],
    ["strike", [{ text: "wrong", strike: true }]],
    ["code", [{ text: "CYP2D6", code: true }]],
    ["bold code", [{ text: "PO BID", code: true, bold: true }]],
    ["highlight", [{ text: "β1", highlight: "yellow" }]],
    [
      "every highlight colour",
      (
        [
          "gray",
          "brown",
          "red",
          "orange",
          "yellow",
          "green",
          "teal",
          "blue",
          "purple",
          "pink",
        ] as const
      ).map((c, i) => ({ text: `w${i}`, highlight: c })),
    ],
    ["link", [{ text: "guideline", link: "https://example.org/htn" }]],
    [
      "all marks at once",
      [
        {
          text: "all",
          bold: true,
          italic: true,
          underline: true,
          strike: true,
          code: true,
          highlight: "green",
          link: "https://a.example",
        },
      ],
    ],
    ["citation marker", [{ text: "Atenolol is β1" }, { cite: 1 }, { text: "." }]],
    ["adjacent markers", [{ text: "x" }, { cite: 1 }, { cite: 2 }]],
    ["concept mention", [{ text: "compare " }, { concept: CONCEPT, text: "propranolol" }]],
    ["line break", [{ text: "line one\nline two" }]],
    ["bold line break", [{ text: "a\nb", bold: true }]],
    ["leading and trailing breaks", [{ text: "\nmiddle\n" }]],
    ["only a marker", [{ cite: 3 }]],
    ["empty", []],
    [
      "the docs example",
      [
        { text: "Metoprolol", bold: true },
        { text: " is β1-selective", highlight: "yellow" },
        { cite: 1 },
        { text: "; compare " },
        { concept: CONCEPT, text: "propranolol" },
      ],
    ],
  ];

  for (const [name, value] of cases) {
    it(`round-trips ${name}`, () => {
      expect(throughEditor(value)).toEqual(normalizeRichText(value));
      expect(inlineToRichText(richTextToInline(value))).toEqual(normalizeRichText(value));
    });
  }

  it("accepts the string shorthand", () => {
    expect(throughEditor("plain words" as unknown as RichText)).toEqual([{ text: "plain words" }]);
  });

  it("maps marks to the expected Tiptap nodes", () => {
    expect(
      richTextToInline([
        { text: "a\nb", bold: true },
        { cite: 2 },
        { concept: CONCEPT, text: "x" },
      ]),
    ).toEqual([
      { type: "text", text: "a", marks: [{ type: "bold" }] },
      { type: "hardBreak", marks: [{ type: "bold" }] },
      { type: "text", text: "b", marks: [{ type: "bold" }] },
      { type: "citation", attrs: { n: 2 } },
      { type: "concept", attrs: { id: CONCEPT, text: "x" } },
    ]);
  });

  it("merges neighbouring runs that end up with the same marks", () => {
    const json: TiptapNode[] = [
      { type: "text", text: "a", marks: [{ type: "italic" }] },
      { type: "text", text: "b", marks: [{ type: "italic" }] },
    ];
    expect(inlineToRichText(json)).toEqual([{ text: "ab", italic: true }]);
  });

  it("drops links that are not http(s), unknown nodes and empty concepts", () => {
    const json: TiptapNode[] = [
      {
        type: "text",
        text: "x",
        marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
      },
      { type: "image", attrs: { src: "y" } },
      { type: "concept", attrs: { id: CONCEPT, text: "" } },
      { type: "citation", attrs: { n: 0 } },
    ];
    expect(inlineToRichText(json)).toEqual([{ text: "x" }]);
  });

  it("joins extra paragraphs with a line break", () => {
    expect(
      docToRichText({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
          { type: "paragraph", content: [{ type: "text", text: "b" }] },
        ],
      }),
    ).toEqual([{ text: "a\nb" }]);
  });
});

describe("list lines", () => {
  it("round-trips items with indents and checked state through the editor schema", () => {
    const items = [
      {
        text: normalizeRichText([{ text: "Bradycardia", bold: true }, { cite: 1 }]),
        indent: 0,
        checked: true,
      },
      { text: normalizeRichText("Fatigue"), indent: 1, checked: false },
      { text: [], indent: 2, checked: false },
    ];
    const node = PMNode.fromJSON(lines, linesToDoc(items));
    node.check();
    expect(docToLines(node.toJSON() as TiptapNode, true)).toEqual(items);
  });

  it("clamps indents so each grows by at most one", () => {
    const doc = linesToDoc([
      { text: [{ text: "a" }], indent: 2 },
      { text: [{ text: "b" }], indent: 2 },
      { text: [{ text: "c" }], indent: 0 },
    ]);
    expect(docToLines(doc, false).map((l) => l.indent)).toEqual([0, 1, 0]);
  });
});

describe("splitting and joining", () => {
  const text: RichText = [{ text: "Hello ", bold: true }, { cite: 1 }, { text: "world" }];

  it("splits inside a run, keeping marks on both halves", () => {
    expect(splitRichText(text, 3)).toEqual([
      [{ text: "Hel", bold: true }],
      [{ text: "lo ", bold: true }, { cite: 1 }, { text: "world" }],
    ]);
  });

  it("counts atoms as one position", () => {
    expect(splitRichText(text, 7)).toEqual([
      [{ text: "Hello ", bold: true }, { cite: 1 }],
      [{ text: "world" }],
    ]);
  });

  it("splits at the ends", () => {
    expect(splitRichText(text, 0)).toEqual([[], text]);
    expect(splitRichText(text, 99)).toEqual([text, []]);
  });

  it("joins and renumbers markers", () => {
    expect(joinRichText([{ text: "a" }], shiftCitations([{ text: "a" }, { cite: 1 }], 2))).toEqual([
      { text: "aa" },
      { cite: 3 },
    ]);
  });
});
