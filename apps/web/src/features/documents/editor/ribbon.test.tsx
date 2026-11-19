import {
  type Block,
  type DocumentWithBlocks,
  stampNewBlock,
  validateBlockInput,
} from "@notes/schema";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { beforeAll, describe, expect, it } from "vitest";
import { ToastProvider } from "../../../components/ui/toast";
import { DocumentView } from "../DocumentView";
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
  if (!result.ok) throw new Error(`invalid test block: ${JSON.stringify(result)}`);
  return stampNewBlock(result.block, { actor: AGENT, id: mockId("blk", 900 + n) });
}

const paragraph = (text: unknown, n = 1) => block({ type: "paragraph", content: { text } }, n);

async function open(blocks: Block[]) {
  const doc: DocumentWithBlocks = {
    ...guideDocument(),
    id: mockId("doc", 78),
    title: "Ribbon test",
    blocks,
    blockIds: blocks.map((b) => b.id),
  };
  const store = new MockDocumentStore({ latency: 0, documents: [doc] });
  render(
    <ToastProvider>
      <DocumentView store={store} documentId={doc.id} initialMode="edit" />
    </ToastProvider>,
  );
  await screen.findByRole("heading", { level: 1 });
  const stored = async () => (await store.loadDocument(doc.id)).blocks;
  return { store, doc, stored };
}

const ribbon = () => screen.getByTestId("format-ribbon");
const styleButton = () => within(ribbon()).getByTestId("block-style");
const types = () =>
  [...document.querySelectorAll('[data-testid="block"]')].map((el) => el.getAttribute("data-type"));

function liveEditor(): Editor {
  const el = document.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
  if (!el?.editor) throw new Error("no editor is open");
  return el.editor;
}

/** Tap the text of the n-th block so its editor opens with the caret at the end. */
async function startTyping(index = 0) {
  const field = await waitFor(() => {
    const el = document
      .querySelectorAll('[data-testid="block"]')
      [index]?.querySelector('[data-testid^="field-"]');
    if (!el) throw new Error(`no field in block ${index}`);
    return el as HTMLElement;
  });
  await userEvent.click(field);
  await waitFor(() => {
    const el = document
      .querySelectorAll('[data-testid="block"]')
      [index]?.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
    expect(el?.editor?.isFocused).toBe(true);
  });
}

/**
 * Typed one key at a time, the way the browser hands keys to ProseMirror: the
 * text-input handlers (Tiptap's typing rules) get each key first, and the key
 * is inserted as plain text when none of them takes it.
 */
function typeKeys(text: string) {
  for (const char of text) {
    act(() => {
      const { view } = liveEditor();
      const { from, to } = view.state.selection;
      const deflt = () => view.state.tr.insertText(char, from, to);
      const handled = view.someProp("handleTextInput", (f) => f(view, from, to, char, deflt));
      if (!handled) view.dispatch(deflt());
    });
  }
}

/** A ribbon button: pressed the way a mouse does it (mouse down first, then the click). */
function press(name: string | RegExp) {
  const button = within(ribbon()).getByRole("button", { name });
  const allowed = fireEvent.mouseDown(button);
  fireEvent.click(button);
  return { button, allowed };
}

describe("the ribbon", () => {
  it("rests, grayed out, until a text field has the caret", async () => {
    await open([paragraph("hello")]);
    expect(ribbon()).toHaveAttribute("data-live", "false");
    expect(styleButton()).toBeDisabled();
    expect(within(ribbon()).getByRole("button", { name: "Bold" })).toBeDisabled();
    await startTyping();
    expect(ribbon()).toHaveAttribute("data-live", "true");
    expect(styleButton()).toBeEnabled();
  });

  it("shows the caret's block kind and the marks at the caret", async () => {
    await open([
      block({ type: "heading", content: { level: 2, text: "Receptors" } }, 1),
      paragraph([{ text: "plain " }, { text: "strong", bold: true }], 2),
    ]);
    await startTyping(0);
    await waitFor(() => expect(styleButton()).toHaveAccessibleName("Block style: Heading 2"));
    await startTyping(1);
    await waitFor(() => expect(styleButton()).toHaveAccessibleName("Block style: Text"));
    const bold = within(ribbon()).getByRole("button", { name: "Bold" });
    // The caret ends up at the end, inside the bold run.
    await waitFor(() => expect(bold).toHaveAttribute("aria-pressed", "true"));
    act(() => void liveEditor().commands.setTextSelection(3));
    await waitFor(() => expect(bold).toHaveAttribute("aria-pressed", "false"));
  });

  it("names a block that cannot change style and stays disabled", async () => {
    await open([block({ type: "table", content: { rows: [["a", "b"]], headerRow: true } }, 1)]);
    await startTyping(0);
    await waitFor(() => expect(styleButton()).toHaveAccessibleName("Block style: Table"));
    expect(styleButton()).toBeDisabled();
  });

  it("does not take the caret or lose the selection when a button is pressed", async () => {
    await open([paragraph("beta blockers")]);
    await startTyping();
    act(() => void liveEditor().commands.setTextSelection({ from: 1, to: 5 }));
    const { allowed } = press("Bold");
    // Mouse down was canceled, so the focus never left the text.
    expect(allowed).toBe(false);
    const editor = liveEditor();
    expect(editor.isFocused).toBe(true);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(5);
    expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
      text: "beta",
      marks: [{ type: "bold" }],
    });
    press("Italic");
    expect(liveEditor().state.selection.to).toBe(5);
    expect(liveEditor().isActive("italic")).toBe(true);
  });
});

describe("the block style menu", () => {
  it("turns a paragraph into a heading, keeping the text and the caret", async () => {
    const { stored } = await open([paragraph("beta blockers")]);
    await startTyping();
    act(() => void liveEditor().commands.setTextSelection(6));
    await userEvent.click(styleButton());
    await userEvent.click(await screen.findByTestId("style-heading1"));
    await waitFor(() => expect(types()).toEqual(["heading"]));
    expect((await stored())[0]?.content).toEqual({ level: 1, text: [{ text: "beta blockers" }] });
    // A new editor for the heading has the caret, where it was.
    await waitFor(() => expect(liveEditor().isFocused).toBe(true));
    expect(liveEditor().state.selection.from).toBe(6);
    await waitFor(() => expect(styleButton()).toHaveAccessibleName("Block style: Heading 1"));
  });

  it("changes a heading's level and turns text into a checklist", async () => {
    const { stored } = await open([
      block({ type: "heading", content: { level: 2, text: "Doses" } }, 1),
    ]);
    await startTyping();
    await userEvent.click(styleButton());
    await userEvent.click(await screen.findByTestId("style-heading3"));
    await waitFor(async () => expect((await stored())[0]?.content).toMatchObject({ level: 3 }));
    await waitFor(() => expect(liveEditor().isFocused).toBe(true));
    act(() => void liveEditor().commands.setTextSelection(3));
    await userEvent.click(styleButton());
    await userEvent.click(await screen.findByTestId("style-checklist"));
    await waitFor(() => expect(types()).toEqual(["checklist"]));
    expect((await stored())[0]?.content).toEqual({
      items: [{ text: [{ text: "Doses" }], checked: false }],
    });
    await waitFor(() => expect(liveEditor().isFocused).toBe(true));
    expect(liveEditor().state.selection.from).toBe(3);
  });

  it("keeps the caret on the right line when a list becomes text", async () => {
    await open([
      block(
        {
          type: "bulleted_list",
          content: {
            items: [
              { text: "one", indent: 0 },
              { text: "two", indent: 0 },
            ],
          },
        },
        1,
      ),
    ]);
    await startTyping();
    // Line two, after "tw": paragraph two starts at 6 ("one" is 3, plus 2 between lines).
    act(() => void liveEditor().commands.setTextSelection(8));
    await userEvent.click(styleButton());
    await userEvent.click(await screen.findByTestId("style-paragraph"));
    await waitFor(() => expect(types()).toEqual(["paragraph"]));
    await waitFor(() => expect(liveEditor().isFocused).toBe(true));
    // In text the lines are joined by a line break: "one", break, then "tw|o".
    expect(liveEditor().state.selection.from).toBe(7);
  });
});

describe("list and indent buttons", () => {
  it("make a list, switch its kind and turn it back into text", async () => {
    const { stored } = await open([paragraph("points")]);
    await startTyping();
    press("Bulleted list");
    await waitFor(() => expect(types()).toEqual(["bulleted_list"]));
    await waitFor(() => expect(liveEditor().isFocused).toBe(true));
    await waitFor(() =>
      expect(within(ribbon()).getByRole("button", { name: "Bulleted list" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    press("Numbered list");
    await waitFor(() => expect(types()).toEqual(["numbered_list"]));
    await waitFor(() => expect(liveEditor().isFocused).toBe(true));
    press("Numbered list");
    await waitFor(() => expect(types()).toEqual(["paragraph"]));
    expect((await stored())[0]?.content).toEqual({ text: [{ text: "points" }] });
  });

  it("indent and outdent the caret's line, only where the list allows", async () => {
    await open([
      block(
        {
          type: "bulleted_list",
          content: {
            items: [
              { text: "one", indent: 0 },
              { text: "two", indent: 0 },
            ],
          },
        },
        1,
      ),
    ]);
    await startTyping();
    const indent = () => within(ribbon()).getByRole("button", { name: "Indent" });
    const outdent = () => within(ribbon()).getByRole("button", { name: "Outdent" });
    // The first line cannot go deeper than a line above it: there is none.
    act(() => void liveEditor().commands.setTextSelection(2));
    await waitFor(() => expect(indent()).toBeDisabled());
    expect(outdent()).toBeDisabled();
    act(() => void liveEditor().commands.setTextSelection(7));
    await waitFor(() => expect(indent()).toBeEnabled());
    press("Indent");
    expect(liveEditor().state.doc.child(1).attrs.indent).toBe(1);
    expect(liveEditor().isFocused).toBe(true);
    await waitFor(() => expect(outdent()).toBeEnabled());
    // One level under the line above is as deep as it goes.
    expect(indent()).toBeDisabled();
    press("Outdent");
    expect(liveEditor().state.doc.child(1).attrs.indent).toBe(0);
  });

  it("are off outside lists", async () => {
    await open([paragraph("text")]);
    await startTyping();
    expect(within(ribbon()).getByRole("button", { name: "Indent" })).toBeDisabled();
  });
});

describe("inserting from the ribbon", () => {
  it("adds a callout after the caret's block with one tap", async () => {
    await open([paragraph("first")]);
    await startTyping();
    press("Insert callout");
    await waitFor(() => expect(types()).toEqual(["paragraph", "callout"]));
  });

  it("opens the insert menu with its search field", async () => {
    await open([paragraph("first")]);
    await startTyping();
    fireEvent.click(within(ribbon()).getByTestId("ribbon-insert"));
    const menu = await screen.findByTestId("insert-menu");
    expect(within(menu).getByRole("textbox", { name: "Find a block type" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByTestId("insert-drug_card"));
    await waitFor(() => expect(types()).toEqual(["paragraph", "drug_card"]));
  });

  it("lists the typing shortcuts", async () => {
    await open([paragraph("first")]);
    await userEvent.click(within(ribbon()).getByTestId("shortcut-help"));
    const list = await screen.findByTestId("shortcut-list");
    expect(list).toHaveTextContent("Heading 1");
    expect(list).toHaveTextContent("**bold**");
  });
});

describe("typing marks", () => {
  const cases: Array<[string, string, string]> = [
    ["**bold** ", "bold", "bold"],
    ["*italic* ", "italic", "italic"],
    ["_italic_ ", "italic", "italic"],
    ["`code` ", "code", "code"],
    ["~~strike~~ ", "strike", "strike"],
    ["==marked== ", "highlight", "marked"],
  ];
  for (const [typed, mark, word] of cases) {
    it(`"${typed.trim()}" becomes ${mark} as the closing characters are typed`, async () => {
      await open([paragraph("")]);
      await startTyping();
      typeKeys(`a ${typed}`);
      const runs = (liveEditor().getJSON().content?.[0]?.content ?? []) as Array<{
        text?: string;
        marks?: Array<{ type: string }>;
      }>;
      const marked = runs.find((run) => run.text === word);
      expect(marked?.marks?.map((m) => m.type)).toContain(mark);
      // The markers themselves are gone.
      expect(liveEditor().state.doc.textContent).toBe(`a ${word} `);
    });
  }

  it("does not turn a lone asterisk at the start into a list", async () => {
    await open([paragraph("")]);
    await startTyping();
    typeKeys("*x* ");
    await new Promise((r) => setTimeout(r, 30));
    expect(types()).toEqual(["paragraph"]);
    expect(liveEditor().isActive("italic")).toBe(false);
    expect(liveEditor().state.doc.textContent).toBe("x ");
  });
});

describe("wide tables", () => {
  it("scroll sideways inside their own box, with a hint at the edge", async () => {
    const wide = Array.from({ length: 8 }, (_, i) => `Column ${i + 1}`);
    await open([block({ type: "table", content: { rows: [wide, wide], headerRow: true } }, 1)]);
    const box = await screen.findByTestId("table-scroll");
    expect(box).toHaveClass("doc-scroll-x");
    expect(box).toHaveAccessibleName("Table");
    // The table sizes to its columns (and at least the box); the box scrolls, nothing clips.
    expect(box.querySelector("table")).toHaveClass("w-max", "min-w-full");
    const wrap = box.parentElement as HTMLElement;
    expect(wrap).toHaveClass("doc-table-wrap");
    Object.defineProperty(box, "scrollWidth", { configurable: true, value: 1200 });
    Object.defineProperty(box, "clientWidth", { configurable: true, value: 600 });
    fireEvent.scroll(box);
    await waitFor(() => expect(wrap).toHaveAttribute("data-more-end", "true"));
    expect(wrap).not.toHaveAttribute("data-more-start");
    // It is reachable by keyboard once it scrolls.
    expect(box).toHaveAttribute("tabindex", "0");
    box.scrollLeft = 600;
    fireEvent.scroll(box);
    await waitFor(() => expect(wrap).toHaveAttribute("data-more-start", "true"));
    expect(wrap).not.toHaveAttribute("data-more-end");
  });
});
