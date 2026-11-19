import { type Block, stampNewBlock, validateBlockInput } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { AGENT } from "../store/fixture";
import { mockId } from "../store/mock-pages";
import { blockLabel, canRestyle, caretAfter, restyleCalls, styleOf } from "./blockStyle";

function block(input: unknown, n = 1): Block {
  const result = validateBlockInput(input, { writer: "user" });
  if (!result.ok) throw new Error("invalid test block");
  return stampNewBlock(result.block, { actor: AGENT, id: mockId("blk", 950 + n) });
}

const DOC = mockId("doc", 95);

describe("block styles", () => {
  it("names the style of each kind of block", () => {
    expect(styleOf(block({ type: "paragraph", content: { text: "a" } }))).toBe("paragraph");
    expect(styleOf(block({ type: "heading", content: { level: 3, text: "a" } }))).toBe("heading3");
    expect(styleOf(block({ type: "checklist", content: { items: [{ text: "a" }] } }))).toBe(
      "checklist",
    );
    const table = block({ type: "table", content: { rows: [["a"]] } });
    expect(styleOf(table)).toBeNull();
    expect(canRestyle(table)).toBe(false);
    expect(blockLabel(table)).toBe("Table");
  });

  it("converts with the existing turn-into replace, the level coming from the style", () => {
    const para = block({ type: "paragraph", content: { text: [{ text: "beta", bold: true }] } });
    const calls = restyleCalls(DOC, para, "heading1");
    expect(calls).toHaveLength(1);
    expect(calls?.[0]?.call).toMatchObject({
      operation: "update_block",
      input: {
        mode: "replace",
        blockId: para.id,
        block: { type: "heading", content: { level: 1, text: [{ text: "beta", bold: true }] } },
      },
    });
    // Same style: nothing to do. A table cannot change style.
    expect(restyleCalls(DOC, para, "paragraph")).toBeNull();
    expect(restyleCalls(DOC, block({ type: "table", content: { rows: [["a"]] } }), "quote")).toBe(
      null,
    );
  });

  it("keeps the block's color and sources when it changes style", () => {
    const quote = block({
      type: "quote",
      content: { text: "said" },
      style: { color: "blue" },
    });
    const calls = restyleCalls(DOC, quote, "bulleted_list");
    expect(calls?.[0]?.call).toMatchObject({
      input: {
        block: {
          type: "bulleted_list",
          style: { color: "blue" },
          content: { items: [{ text: [{ text: "said" }], indent: 0 }] },
        },
      },
    });
  });

  it("maps the caret between a single field and a list editor", () => {
    const caret = { line: 1, offset: 2, lines: [3, 5] };
    // Lists: two positions between paragraphs. Text: one hard break.
    expect(caretAfter(caret, "bulleted_list")).toBe(3 + 2 + 2);
    expect(caretAfter(caret, "paragraph")).toBe(3 + 1 + 2);
    expect(caretAfter({ line: 0, offset: 4, lines: [9] }, "heading")).toBe(4);
  });
});
