import { type Block, type BlockOf, normalizeRichText, validateOperation } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { GUIDE_ID, guideDocument, HER } from "../store/fixture";
import {
  deleteBlocks,
  duplicateBlock,
  INSERTABLE_TYPES,
  insertBlock,
  mergeIntoPrevious,
  moveBy,
  moveTo,
  NEEDS_PAGE,
  newBlockInput,
  patchContent,
  setStyle,
  splitTextBlock,
  turnInto,
} from "./gestures";
import { applyCalls, inverseOfAll, type PendingCall } from "./ops";

const doc = guideDocument();
const byType = <T extends Block["type"]>(type: T) =>
  doc.blocks.find((b) => b.type === type) as BlockOf<T>;
const paragraph = byType("paragraph");
const ctx = { actor: HER };

/** Every emitted call is a valid writer operation for her. */
function expectValid(calls: PendingCall[]) {
  for (const { call } of calls) {
    const result = validateOperation(call.operation, call.input, { writer: "user" });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  }
}

/** Applying and then applying the inverse gives the original blocks back (content-wise). */
function expectUndoable(calls: PendingCall[]) {
  const after = applyCalls(doc, calls, ctx).doc;
  const inverse = inverseOfAll(doc, calls, ctx);
  const back = applyCalls(after, inverse, ctx).doc;
  const strip = (blocks: typeof doc.blocks) =>
    blocks.map((b) => ({
      id: b.id,
      type: b.type,
      content: b.content,
      citations: b.citations,
      style: b.style,
    }));
  expect(strip(back.blocks)).toEqual(strip(doc.blocks));
}

describe("editing gestures emit exact writer operations", () => {
  it("typing patches the text field", () => {
    const calls = patchContent(GUIDE_ID, paragraph.id, { text: [{ text: "New words" }] });
    expect(calls).toEqual([
      {
        call: {
          operation: "update_block",
          input: {
            mode: "patch",
            documentId: GUIDE_ID,
            blockId: paragraph.id,
            patch: { content: { text: [{ text: "New words" }] } },
          },
        },
      },
    ]);
    expectValid(calls);
    expectUndoable(calls);
  });

  it("Enter in the middle splits into a patch and an insert after the block", () => {
    const calls = splitTextBlock(
      GUIDE_ID,
      paragraph,
      [{ text: "Before" }],
      [{ text: "After" }],
      "blk_01JC0000000000000000009999",
    );
    expect(calls).toEqual([
      {
        call: {
          operation: "update_block",
          input: {
            mode: "patch",
            documentId: GUIDE_ID,
            blockId: paragraph.id,
            patch: { content: { text: [{ text: "Before" }] } },
          },
        },
      },
      {
        call: {
          operation: "insert_blocks",
          input: {
            documentId: GUIDE_ID,
            blocks: [{ type: "paragraph", content: { text: [{ text: "After" }] } }],
            position: { after: paragraph.id },
          },
        },
        clientIds: ["blk_01JC0000000000000000009999"],
      },
    ]);
    expectValid(calls);
    expectUndoable(calls);
    const after = applyCalls(doc, calls, ctx).doc;
    const at = after.blockIds.indexOf(paragraph.id);
    expect(after.blockIds[at + 1]).toBe("blk_01JC0000000000000000009999");
    expect(after.blocks[at + 1]?.origin).toBe("user");
  });

  it("a split that carries citation markers copies the citations", () => {
    const calls = splitTextBlock(
      GUIDE_ID,
      paragraph,
      [{ text: "a" }],
      [{ text: "b" }, { cite: 2 }],
    );
    const insert = calls[1]?.call as unknown as {
      operation: string;
      input: { blocks: Array<{ citations: unknown }> };
    };
    expect(insert.operation).toBe("insert_blocks");
    expect(insert.input.blocks[0]?.citations).toEqual(paragraph.citations);
    expectValid(calls);
  });

  it("Backspace at the start merges into the previous text block, renumbering markers", () => {
    const first = { ...paragraph, id: "blk_01JC0000000000000000000201" };
    const second = {
      ...paragraph,
      id: "blk_01JC0000000000000000000202",
      citations: paragraph.citations.slice(0, 1),
    };
    const calls = mergeIntoPrevious(
      GUIDE_ID,
      first,
      second,
      normalizeRichText([{ text: "tail" }, { cite: 1 }]),
    );
    expect(calls).toEqual([
      {
        call: {
          operation: "update_block",
          input: {
            mode: "patch",
            documentId: GUIDE_ID,
            blockId: first.id,
            patch: {
              content: {
                text: [...paragraph.content.text.slice(0, -1), { text: ".tail" }, { cite: 4 }],
              },
              citations: [...paragraph.citations, ...second.citations],
            },
          },
        },
      },
      {
        call: {
          operation: "delete_blocks",
          input: { documentId: GUIDE_ID, blockIds: [second.id] },
        },
      },
    ]);
  });

  it("will not merge into a structured block", () => {
    expect(mergeIntoPrevious(GUIDE_ID, byType("drug_card"), paragraph, [])).toBeNull();
  });

  it("the + button and / menu insert a default block after the current one", () => {
    for (const type of INSERTABLE_TYPES.filter((t) => !NEEDS_PAGE.includes(t))) {
      const calls = insertBlock(
        GUIDE_ID,
        paragraph.id,
        newBlockInput(type),
        "blk_01JC0000000000000000008888",
      );
      expect(calls[0]?.call).toMatchObject({
        operation: "insert_blocks",
        input: { position: { after: paragraph.id } },
      });
      expectValid(calls);
    }
  });

  it("an image block needs a page and then is valid", () => {
    const image = {
      fileId: "fil_01JC0000000000000000000001",
      pageId: "pag_01JC0000000000000000000014",
    };
    expectValid(insertBlock(GUIDE_ID, null, newBlockInput("image", { image })));
    expectValid(insertBlock(GUIDE_ID, null, newBlockInput("labelled_image", { image })));
  });

  it("delete, duplicate and colour", () => {
    expect(deleteBlocks(GUIDE_ID, [paragraph.id])).toEqual([
      {
        call: {
          operation: "delete_blocks",
          input: { documentId: GUIDE_ID, blockIds: [paragraph.id] },
        },
      },
    ]);
    expectUndoable(deleteBlocks(GUIDE_ID, [paragraph.id]));
    const dup = duplicateBlock(GUIDE_ID, paragraph, "blk_01JC0000000000000000007777");
    expect(dup[0]?.call.operation).toBe("insert_blocks");
    expectValid(dup);
    expectUndoable(dup);
    expect(setStyle(GUIDE_ID, paragraph.id, { background: "teal" })).toEqual([
      {
        call: {
          operation: "update_block",
          input: {
            mode: "patch",
            documentId: GUIDE_ID,
            blockId: paragraph.id,
            patch: { style: { background: "teal" } },
          },
        },
      },
    ]);
    expectUndoable(setStyle(GUIDE_ID, paragraph.id, { background: "teal" }));
  });

  it("move up and down use before and after the neighbour", () => {
    const at = doc.blockIds.indexOf(paragraph.id);
    expect(moveBy(GUIDE_ID, doc.blockIds, paragraph.id, -1)?.[0]?.call).toEqual({
      operation: "move_blocks",
      input: {
        documentId: GUIDE_ID,
        blockIds: [paragraph.id],
        position: { before: doc.blockIds[at - 1] },
      },
    });
    expect(moveBy(GUIDE_ID, doc.blockIds, paragraph.id, 1)?.[0]?.call).toEqual({
      operation: "move_blocks",
      input: {
        documentId: GUIDE_ID,
        blockIds: [paragraph.id],
        position: { after: doc.blockIds[at + 1] },
      },
    });
    expect(moveBy(GUIDE_ID, doc.blockIds, doc.blockIds[0] as string, -1)).toBeNull();
    expectUndoable(moveBy(GUIDE_ID, doc.blockIds, paragraph.id, 1) as PendingCall[]);
  });

  it("drag drops before a block or at the end", () => {
    expect(moveTo(GUIDE_ID, paragraph.id, null)[0]?.call.input).toEqual({
      documentId: GUIDE_ID,
      blockIds: [paragraph.id],
      position: "end",
    });
    const target = doc.blockIds[0] as string;
    expect(moveTo(GUIDE_ID, paragraph.id, target)[0]?.call.input).toMatchObject({
      position: { before: target },
    });
    expectUndoable(moveTo(GUIDE_ID, paragraph.id, target));
  });

  it("turn into replaces the block, keeping text and citations", () => {
    const calls = turnInto(GUIDE_ID, paragraph, "bulleted_list");
    expect(calls[0]?.call).toMatchObject({
      operation: "update_block",
      input: {
        mode: "replace",
        blockId: paragraph.id,
        block: { type: "bulleted_list", citations: paragraph.citations },
      },
    });
    expectValid(calls);
    expectUndoable(calls);
    for (const type of ["heading", "quote", "callout", "checklist", "numbered_list"] as const)
      expectValid(turnInto(GUIDE_ID, paragraph, type));
    expectValid(turnInto(GUIDE_ID, byType("bulleted_list"), "paragraph"));
    expectValid(turnInto(GUIDE_ID, byType("bulleted_list"), "checklist"));
  });

  it("structured editors patch content fields (table row, drug card field)", () => {
    const table = byType("table");
    const rows = [...table.content.rows, table.content.rows[0]?.map(() => [])];
    const calls = patchContent(GUIDE_ID, table.id, { rows });
    expectValid(calls);
    const after = applyCalls(doc, calls, ctx).doc.blocks.find(
      (b) => b.id === table.id,
    ) as BlockOf<"table">;
    expect(after.content.rows).toHaveLength(table.content.rows.length + 1);
    const card = byType("drug_card");
    const dosing = [
      { ...card.content.dosingNotes[0], text: [{ text: "Start 12.5 mg PO BID" }] },
      ...card.content.dosingNotes.slice(1),
    ];
    const cardCalls = patchContent(GUIDE_ID, card.id, { dosingNotes: dosing });
    expectValid(cardCalls);
    const edited = applyCalls(doc, cardCalls, ctx).doc.blocks.find(
      (b) => b.id === card.id,
    ) as BlockOf<"drug_card">;
    expect(edited.origin).toBe("user");
    expect(edited.content.dosingNotes[0]?.citations).toEqual(
      card.content.dosingNotes[0]?.citations,
    );
    expect(edited.content.adverseEffects).toEqual(card.content.adverseEffects);
  });
});
