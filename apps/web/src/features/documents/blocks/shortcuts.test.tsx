import {
  type Block,
  type DocumentWithBlocks,
  stampNewBlock,
  validateBlockInput,
} from "@notes/schema";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { beforeAll, describe, expect, it } from "vitest";
import { ToastProvider } from "../../../components/ui/toast";
import { DocumentView } from "../DocumentView";
import { shortcutFor } from "../model/shortcuts";
import { AGENT, guideDocument } from "../store/fixture";
import { mockId } from "../store/mock-pages";
import { MockDocumentStore } from "../store/mock-store";

// jsdom has no layout; ProseMirror asks text ranges where they are when it scrolls to the caret.
beforeAll(() => {
  const empty = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => ({ ...empty, toJSON: () => empty }) as DOMRect;
});

function block(input: unknown, n: number): Block {
  const result = validateBlockInput(input, { writer: "user" });
  if (!result.ok) throw new Error("invalid test block");
  return stampNewBlock(result.block, { actor: AGENT, id: mockId("blk", 800 + n) });
}

const paragraph = (text: string, n = 1) =>
  block({ type: "paragraph", content: { text: text ? [{ text }] : [] } }, n);

function docOf(blocks: Block[]): DocumentWithBlocks {
  return {
    ...guideDocument(),
    id: mockId("doc", 77),
    title: "Typing test",
    blocks,
    blockIds: blocks.map((b) => b.id),
  };
}

async function open(blocks: Block[], props: { startWriting?: boolean } = {}) {
  const doc = docOf(blocks);
  const store = new MockDocumentStore({ latency: 0, documents: [doc] });
  render(
    <ToastProvider>
      <DocumentView store={store} documentId={doc.id} initialMode="edit" {...props} />
    </ToastProvider>,
  );
  await screen.findByRole("heading", { level: 1 });
  return { store, doc };
}

const types = () =>
  [...document.querySelectorAll('[data-testid="block"]')].map((el) => el.getAttribute("data-type"));

/** The live Tiptap editor of the field being edited. */
function liveEditor(): Editor {
  const el = document.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
  if (!el?.editor) throw new Error("no editor is open");
  return el.editor;
}

/** Tap the block's text so its editor opens with the caret at the end. */
async function startTyping(index = 0) {
  await waitFor(() =>
    expect(document.querySelectorAll('[data-testid^="field-"]').length).toBeGreaterThan(index),
  );
  const field = document.querySelectorAll('[data-testid^="field-"]')[index] as HTMLElement;
  await userEvent.click(field);
  await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
}

/** Typed one character at a time, as a keyboard would, so each one is its own update. */
function type(text: string) {
  for (const char of text) act(() => void liveEditor().commands.insertContent(char));
}

async function typeAtStart(text: string) {
  await startTyping();
  act(() => void liveEditor().commands.setTextSelection(1));
  type(text);
}

const texts = (store: MockDocumentStore, doc: DocumentWithBlocks) =>
  store.loadDocument(doc.id).then((d) => d.blocks);

describe("shortcut table", () => {
  it("maps each trigger", () => {
    expect(shortcutFor("#")).toEqual({ type: "heading", level: 1 });
    expect(shortcutFor("##")).toEqual({ type: "heading", level: 2 });
    expect(shortcutFor("###")).toEqual({ type: "heading", level: 3 });
    // The schema has three levels; more hashes clamp to the last.
    expect(shortcutFor("######")).toEqual({ type: "heading", level: 3 });
    expect(shortcutFor("-")?.type).toBe("bulleted_list");
    expect(shortcutFor("*")?.type).toBe("bulleted_list");
    expect(shortcutFor("1.")?.type).toBe("numbered_list");
    expect(shortcutFor("12)")?.type).toBe("numbered_list");
    expect(shortcutFor("[]")?.type).toBe("checklist");
    expect(shortcutFor("[ ]")?.type).toBe("checklist");
    expect(shortcutFor(">")?.type).toBe("quote");
    expect(shortcutFor("!!")).toEqual({ type: "callout", kind: "warning" });
    expect(shortcutFor("??")).toEqual({ type: "callout", kind: "tip" });
    expect(shortcutFor("---")?.type).toBe("divider");
    expect(shortcutFor("a")).toBeNull();
  });
});

describe("typing shortcuts", () => {
  const cases: Array<[string, string, string]> = [
    ["# ", "heading", "1"],
    ["## ", "heading", "2"],
    ["### ", "heading", "3"],
    ["- ", "bulleted_list", ""],
    ["* ", "bulleted_list", ""],
    ["1. ", "numbered_list", ""],
    ["12) ", "numbered_list", ""],
    ["[] ", "checklist", ""],
    ["[ ] ", "checklist", ""],
    ["> ", "quote", ""],
    ["!! ", "callout", "warning"],
    ["?? ", "callout", "tip"],
  ];
  for (const [typed, type_, detail] of cases) {
    it(`"${typed}" at the start of a paragraph makes a ${type_} ${detail}`.trim(), async () => {
      const { store, doc } = await open([paragraph("")]);
      await typeAtStart(typed);
      await waitFor(() => expect(types()).toEqual([type_]));
      const [made] = await texts(store, doc);
      const content = made?.content as { level?: number; kind?: string };
      if (type_ === "heading") expect(String(content.level)).toBe(detail);
      if (type_ === "callout") expect(content.kind).toBe(detail);
    });
  }

  it("keeps the text after the trigger and drops the trigger", async () => {
    const { store, doc } = await open([paragraph("beta blockers")]);
    await typeAtStart("## ");
    await waitFor(() => expect(types()).toEqual(["heading"]));
    const [made] = await texts(store, doc);
    expect(made?.content).toEqual({ level: 2, text: [{ text: "beta blockers" }] });
    // The caret is in the new heading's editor, at the start of the kept text.
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    expect(liveEditor().state.selection.from).toBe(1);
  });

  it("puts the rest of the text into a list item", async () => {
    const { store, doc } = await open([paragraph("rest")]);
    await typeAtStart("- ");
    await waitFor(() => expect(types()).toEqual(["bulleted_list"]));
    const [made] = await texts(store, doc);
    expect(made?.content).toEqual({ items: [{ text: [{ text: "rest" }], indent: 0 }] });
  });

  it("undo brings the paragraph back with the typed characters", async () => {
    const { store, doc } = await open([paragraph("rest")]);
    await typeAtStart("# ");
    await waitFor(() => expect(types()).toEqual(["heading"]));
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    await userEvent.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(types()).toEqual(["paragraph"]));
    const [back] = await texts(store, doc);
    expect(back?.content).toEqual({ text: [{ text: "# rest" }] });
  });

  it("makes a divider from --- and a space, with a fresh paragraph after it", async () => {
    const { store, doc } = await open([paragraph("")]);
    await typeAtStart("--- ");
    await waitFor(() => expect(types()).toEqual(["divider", "paragraph"]));
    const blocks = await texts(store, doc);
    expect(blocks[1]?.content).toEqual({ text: [] });
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
  });

  it("makes a divider from --- and Enter, and the caret moves to the new paragraph", async () => {
    const { store, doc } = await open([paragraph("")]);
    await startTyping();
    type("---");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(types()).toEqual(["divider", "paragraph"]));
    const blocks = await texts(store, doc);
    expect(blocks.map((b) => b.type)).toEqual(["divider", "paragraph"]);
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    expect(liveEditor().state.doc.textContent).toBe("");
  });

  describe("does nothing", () => {
    it("when the prefix comes in the middle of text", async () => {
      const { store, doc } = await open([paragraph("ab")]);
      await startTyping();
      act(() => void liveEditor().commands.setTextSelection(2));
      type("# ");
      await new Promise((r) => setTimeout(r, 30));
      expect(types()).toEqual(["paragraph"]);
      expect(liveEditor().state.doc.textContent).toBe("a# b");
      expect((await texts(store, doc))[0]?.type).toBe("paragraph");
    });

    it("when text is typed before the prefix and then a space", async () => {
      await open([paragraph("")]);
      await startTyping();
      type("x- ");
      await new Promise((r) => setTimeout(r, 30));
      expect(types()).toEqual(["paragraph"]);
    });

    it("in a heading", async () => {
      const heading = block({ type: "heading", content: { level: 2, text: "" } }, 2);
      await open([heading]);
      await startTyping();
      type("- ");
      await new Promise((r) => setTimeout(r, 30));
      expect(types()).toEqual(["heading"]);
    });

    it("in a list line", async () => {
      const list = block(
        { type: "bulleted_list", content: { items: [{ text: "", indent: 0 }] } },
        3,
      );
      await open([list]);
      await startTyping();
      type("# ");
      await new Promise((r) => setTimeout(r, 30));
      expect(types()).toEqual(["bulleted_list"]);
      expect(liveEditor().state.doc.textContent).toBe("# ");
    });

    it("for text that is not a trigger", async () => {
      await open([paragraph("")]);
      await typeAtStart("#a ");
      await new Promise((r) => setTimeout(r, 30));
      expect(types()).toEqual(["paragraph"]);
    });
  });
});

describe("a quote or heading turns back into a paragraph on Backspace at its start", () => {
  it("does so for an empty heading", async () => {
    await open([block({ type: "heading", content: { level: 1, text: "" } }, 4)]);
    await startTyping();
    await userEvent.keyboard("{Backspace}");
    await waitFor(() => expect(types()).toEqual(["paragraph"]));
  });
});

describe("startWriting", () => {
  it("gives an empty document one paragraph with the caret in it, with a hint", async () => {
    const { store, doc } = await open([], { startWriting: true });
    await waitFor(() => expect(types()).toEqual(["paragraph"]));
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    expect(document.activeElement).toBe(document.querySelector(".ProseMirror"));
    expect((await texts(store, doc)).length).toBe(1);
    const placeholder = document.querySelector(".ProseMirror p[data-placeholder]");
    expect(placeholder?.getAttribute("data-placeholder")).toBe(
      'Type your notes, or "/" for blocks',
    );
  });

  it("does nothing when the document has blocks", async () => {
    await open([paragraph("hello")], { startWriting: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(types()).toEqual(["paragraph"]);
    expect(document.querySelector(".ProseMirror")).toBeNull();
  });

  it("does nothing without the prop", async () => {
    await open([]);
    await new Promise((r) => setTimeout(r, 50));
    expect(types()).toEqual([]);
  });

  it("does not put the paragraph back after she deletes it", async () => {
    const { store, doc } = await open([], { startWriting: true });
    await waitFor(() => expect(types()).toEqual(["paragraph"]));
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    await userEvent.keyboard("{Backspace}");
    await waitFor(() => expect(types()).toEqual([]));
    await new Promise((r) => setTimeout(r, 50));
    expect(types()).toEqual([]);
    expect((await texts(store, doc)).length).toBe(0);
  });
});
