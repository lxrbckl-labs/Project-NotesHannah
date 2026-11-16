import type { CanvasOp } from "@notes/schema";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasView } from "./CanvasView";
import { createLayoutRunner } from "./layout/layout-client";
import { MemoryCanvasStore } from "./store/memory-store";
import { buildSeed, DEMO_DOCUMENT_ID, DEMO_USER } from "./store/seed";

/**
 * Component tests: each gesture, through the real view, produces the
 * expected ops at the store. React Flow needs a few browser APIs jsdom
 * lacks; these stand-ins follow React Flow's testing guide.
 */
beforeAll(() => {
  class ResizeObserverStub {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  class DOMMatrixStub {
    m22: number;
    constructor(transform: string) {
      const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
      this.m22 = scale !== undefined ? +scale : 1;
    }
  }
  globalThis.DOMMatrixReadOnly = DOMMatrixStub as unknown as typeof DOMMatrixReadOnly;
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      get() {
        return Number.parseFloat(this.style.height) || 120;
      },
    },
    offsetWidth: {
      get() {
        return Number.parseFloat(this.style.width) || 280;
      },
    },
  });
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
});

function setup() {
  const { document, ref } = buildSeed();
  const store = new MemoryCanvasStore({ actor: DEMO_USER, documents: [document], debounceMs: 10 });
  const opened: string[] = [];
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <CanvasView
        store={store}
        documentId={DEMO_DOCUMENT_ID}
        layoutRunner={createLayoutRunner({ worker: false })}
        onOpenBlock={(id) => opened.push(id)}
      />
    </div>,
  );
  const ops = () => store.log.flatMap((entry) => entry.ops);
  const last = <K extends CanvasOp["op"]>(op: K) =>
    ops()
      .filter((o): o is Extract<CanvasOp, { op: K }> => o.op === op)
      .at(-1);
  return { store, ref, opened, ops, last, ...utils };
}

async function ready() {
  await waitFor(
    () => expect(screen.getByTestId("canvas-view")).toHaveAttribute("data-ready", "true"),
    {
      timeout: 10_000,
    },
  );
}

function node(id: string): HTMLElement {
  const el = document.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!el) throw new Error(`no node ${id}`);
  return el as HTMLElement;
}

// Full renders with ELK on the main thread: generous time under a loaded test run.
describe("CanvasView gestures", { timeout: 30_000 }, () => {
  it("adds a note (insert_items, then update_card with her text)", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: /Add note/ }));
    await waitFor(() => expect(last("insert_items")?.cards[0]?.content.kind).toBe("note"));
    const inserted = last("insert_items")?.cards[0];
    expect(inserted?.origin).toBe("user");
    expect(inserted?.position?.placedBy).toEqual(DEMO_USER);
    const editor = await screen.findByRole("textbox", { name: "Note text" });
    fireEvent.change(editor, { target: { value: "Bisoprolol is β1 too" } });
    fireEvent.blur(editor);
    await waitFor(() => expect(last("update_card")?.id).toBe(inserted?.id));
    expect(last("update_card")?.patch.content).toEqual({
      kind: "note",
      text: [{ text: "Bisoprolol is β1 too" }],
    });
  });

  it("adds a sticker from the picker", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Add sticker" }));
    await user.click(await screen.findByRole("button", { name: "Add Heart sticker" }));
    await waitFor(() =>
      expect(last("insert_items")?.cards[0]?.content).toEqual({
        kind: "sticker",
        sticker: "heart",
      }),
    );
  });

  it("connect mode: tap source, tap target, then label and kind", async () => {
    const user = userEvent.setup();
    const { last, ref } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: /Connect cards/ }));
    expect(screen.getByTestId("mode-hint")).toHaveTextContent("start from");
    fireEvent.click(node(ref.receptors as string));
    expect(screen.getByTestId("mode-hint")).toHaveTextContent("connect to");
    fireEvent.click(node(ref.hypo as string));
    await waitFor(() =>
      expect(last("insert_items")?.connectors[0]).toMatchObject({
        from: ref.receptors,
        to: ref.hypo,
      }),
    );
    const editor = await screen.findByTestId("connector-editor");
    await user.click(within(editor).getByRole("button", { name: "treats" }));
    await waitFor(() => expect(last("update_connector")?.patch).toEqual({ kind: "treats" }));
    const input = within(editor).getByRole("textbox", { name: "Connector label" });
    await user.type(input, "hides tremor{Enter}");
    await waitFor(() => expect(last("update_connector")?.patch).toEqual({ label: "hides tremor" }));
  });

  it("deletes the selection with the keyboard, and undo puts it back with its connectors", async () => {
    const user = userEvent.setup();
    const { last, ref, store } = setup();
    await ready();
    const id = ref.mech as string;
    const before = store
      .current(DEMO_DOCUMENT_ID)
      .canvas.connectors.filter((e) => e.from === id || e.to === id);
    expect(before.length).toBeGreaterThan(0);
    fireEvent.click(node(id));
    await user.keyboard("{Delete}");
    await waitFor(() => expect(last("remove_card")?.id).toBe(id));
    expect(await screen.findByTestId("toast")).toHaveTextContent("Deleted 1 card");
    await user.click(within(screen.getByTestId("toast")).getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(last("insert_items")?.cards.map((c) => c.id)).toEqual([id]));
    expect(
      last("insert_items")
        ?.connectors.map((c) => c.id)
        .sort(),
    ).toEqual(before.map((c) => c.id).sort());
  });

  it("double click opens the block in the page view", async () => {
    const { opened, ref, store } = setup();
    await ready();
    const card = store.current(DEMO_DOCUMENT_ID).canvas.cards.find((c) => c.id === ref.mech);
    // d3-drag needs a real window on mousedown, so clicks are dispatched directly.
    // Pin the clock so the two clicks always fall inside the double-tap window, however busy the machine is.
    let now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    fireEvent.click(node(ref.mech as string));
    now = 1100;
    fireEvent.click(node(ref.mech as string));
    clock.mockRestore();
    expect(opened).toEqual([card?.content.kind === "block" ? card.content.blockIds[0] : ""]);
  });

  it("frames: list, rename, reorder and step through", async () => {
    const user = userEvent.setup();
    const { last } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Frames" }));
    const panel = screen.getByTestId("frame-panel");
    await user.click(within(panel).getByRole("button", { name: "Rename Counselling" }));
    const input = within(panel).getByRole("textbox", { name: "Frame title" });
    await user.clear(input);
    await user.type(input, "Talking to patients{Enter}");
    await waitFor(() =>
      expect(last("update_frame")?.patch).toEqual({ title: "Talking to patients" }),
    );
    await user.click(
      within(panel).getByRole("button", { name: "Move Talking to patients earlier" }),
    );
    await waitFor(() => expect(last("update_frame")?.patch).toEqual({ order: 2 }));
    await user.click(within(panel).getByRole("button", { name: "Step through" }));
    expect(screen.getByTestId("step-title")).toHaveTextContent("Mechanism");
    await user.click(screen.getByRole("button", { name: "Next frame" }));
    expect(screen.getByTestId("step-title")).toHaveTextContent("Selective vs non-selective");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByTestId("step-title")).toHaveTextContent("Talking to patients");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("step-bar")).toBeNull();
  });

  it("release pins asks first, then releases", async () => {
    const user = userEvent.setup();
    const { last, ops } = setup();
    await ready();
    await user.click(screen.getByRole("button", { name: "Release all placed cards" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Release every placed card?");
    expect(ops().some((o) => o.op === "release_pins")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(last("release_pins")).toEqual({ op: "release_pins" }));
  });

  it("picks up block changes from the document", async () => {
    const { store } = setup();
    await ready();
    const count = document.querySelectorAll(".react-flow__node-card").length;
    const doc = store.current(DEMO_DOCUMENT_ID);
    act(() => store.setBlocks(DEMO_DOCUMENT_ID, doc.blocks.slice(0, -1)));
    await waitFor(() =>
      expect(document.querySelectorAll(".react-flow__node-card").length).toBe(count - 1),
    );
  });
});
