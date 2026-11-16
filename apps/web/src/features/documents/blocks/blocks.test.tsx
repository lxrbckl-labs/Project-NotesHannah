import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  type Block,
  type DocumentWithBlocks,
  stampNewBlock,
  validateBlockInput,
} from "@notes/schema";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentView } from "../DocumentView";
import { AGENT, guideDocument } from "../store/fixture";
import { mockId } from "../store/mock-pages";
import { MockDocumentStore } from "../store/mock-store";

function docOf(blocks: Block[], n = 9): DocumentWithBlocks {
  return {
    ...guideDocument(),
    id: mockId("doc", n),
    title: "Test document",
    blocks,
    blockIds: blocks.map((b) => b.id),
  };
}

function exampleBlock(type: (typeof BLOCK_TYPES)[number], i: number): Block {
  const result = validateBlockInput(BLOCK_REGISTRY[type].example, { writer: "agent" });
  if (!result.ok) throw new Error(`example ${type} invalid`);
  return stampNewBlock(result.block, { actor: AGENT, id: mockId("blk", 900 + i) });
}

async function show(doc: DocumentWithBlocks) {
  const store = new MockDocumentStore({ latency: 0, documents: [doc] });
  render(<DocumentView store={store} documentId={doc.id} initialMode="read" />);
  await screen.findByRole("heading", { level: 1 });
  return store;
}

describe("block renderers", () => {
  it("renders the registry's example of every block type", async () => {
    const blocks = BLOCK_TYPES.map(exampleBlock);
    await show(docOf(blocks));
    for (const type of BLOCK_TYPES) {
      const el = document.querySelector(`[data-testid="block"][data-type="${type}"]`);
      expect(el, type).not.toBeNull();
      expect(el?.querySelector('[data-testid="unknown-block"]'), type).toBeNull();
    }
    // Spot checks of what each renderer shows.
    expect(
      screen.getByRole("heading", { name: "Beta-adrenergic antagonists" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Drug card: metoprolol")).toBeInTheDocument();
    expect(screen.getByLabelText("Mnemonic: BAD")).toBeInTheDocument();
    // The example cites an invented file, so the image shows as unavailable; the labels stay.
    expect(screen.getByText("β1: heart")).toBeInTheDocument();
    expect(screen.getAllByText("This page is unavailable").length).toBeGreaterThan(0);
    expect(screen.getByTestId("mind-map")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Section break" })).toBeInTheDocument();
    expect(screen.getByText("Practice question")).toBeInTheDocument();
  });

  it("renders the beta-blocker guide: trust signals, chips, flags and references", async () => {
    const guide = guideDocument();
    await show(docOf(guide.blocks));
    const unverified = guide.blocks.filter(
      (b) => b.type !== "divider" && b.review.status === "unverified",
    );
    expect(screen.getAllByTestId("unverified-badge")).toHaveLength(unverified.length);
    expect(screen.getByTestId("unverified-number")).toHaveTextContent(String(unverified.length));
    expect(screen.getAllByText("Not from your notes").length).toBeGreaterThanOrEqual(2);
    // Inline flag on the flagged word, and the drug card's dose flag.
    expect(screen.getAllByTestId("flag-mark").map((el) => el.textContent)).toContain("bisoprolol");
    const dosing = screen.getByTestId("drug-dosingNotes");
    expect(within(dosing).getAllByTestId("flag-indicator").length).toBe(2);
    expect(within(dosing).getAllByTestId("cite-chip").length).toBeGreaterThan(0);
    // References are numbered without gaps.
    const refs = screen.getAllByTestId("reference");
    expect(refs[0]).toHaveTextContent(/^1/);
    expect(refs.at(-1)).toHaveTextContent(new RegExp(`^${refs.length}`));
    // The trashed and deleted sources say so.
    await waitFor(() => expect(screen.getByText(/Source in the trash/)).toBeInTheDocument());
    expect(screen.getByText("Source deleted")).toBeInTheDocument();
  });

  it("shows an unknown block type as a fallback, never a crash", async () => {
    const strange = {
      ...exampleBlock("paragraph", 0),
      id: mockId("blk", 950),
      type: "flowchart",
    } as unknown as Block;
    await show(docOf([exampleBlock("heading", 1), strange]));
    expect(screen.getByTestId("unknown-block")).toHaveTextContent("flowchart");
    expect(
      screen.getByRole("heading", { name: "Beta-adrenergic antagonists" }),
    ).toBeInTheDocument();
  });
});
