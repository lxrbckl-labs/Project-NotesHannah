import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConceptsIndex } from "../ConceptsIndex";
import { ConceptView } from "../ConceptView";
import { seededRng } from "../model/drill";
import { createMockConceptsStore } from "../store/mock";
import { brandPairs, KEY } from "../store/seed";
import type { ConceptsStore } from "../types";

vi.mock("../ui/ask", () => ({
  AskButton: ({ label }: { label?: string }) => <button type="button">{label ?? "Ask"}</button>,
  RequestComposer: ({ open, defaultMessage }: { open: boolean; defaultMessage?: string }) =>
    open ? (
      <div role="dialog" aria-label="Composer stub">
        {defaultMessage}
      </div>
    ) : null,
}));

const id = (key: string) => KEY[key] as string;

function setup(store: ConceptsStore = createMockConceptsStore()) {
  const handlers = {
    openSource: vi.fn(),
    openNode: vi.fn(),
    onOpenConcept: vi.fn(),
    onOpenIndex: vi.fn(),
    onOpenDocument: vi.fn(),
    onOpenQuestion: vi.fn(),
  };
  return { store, ...handlers };
}

function renderConcept(key: string, s = setup()) {
  window.innerWidth = 390; // phone: the neighbourhood opens as a list
  render(<ConceptView {...s} params={{ id: id(key) }} search={new URLSearchParams()} />);
  return s;
}

describe("ConceptView", () => {
  it("shows a drug's names, name check and review state discreetly", async () => {
    renderConcept("metoprolol");
    expect(await screen.findByTestId("concept-name")).toHaveTextContent("Metoprolol");
    expect(screen.getByText("Also called metoprolol tartrate")).toBeInTheDocument();
    expect(screen.getByTestId("brand-name")).toHaveTextContent("Lopressor");
    expect(screen.getByTestId("name-check")).toHaveAttribute("data-status", "matched");
    expect(screen.getByText("Reviewed by you")).toBeInTheDocument();
  });

  it("offers a suggestion for a misspelt name and an unchecked drug quietly", async () => {
    renderConcept("verapamil");
    expect(await screen.findByText("Did you mean “verapamil hydrochloride”?")).toBeInTheDocument();
  });

  it("groups relations into readable sections with severity, effect and citations", async () => {
    renderConcept("acei");
    await screen.findByTestId("relations");
    const titles = screen.getAllByTestId("relation-title").map((n) => n.textContent);
    expect(titles).toEqual([
      "Mechanism",
      "Treats",
      "Adverse effects",
      "Interactions",
      "Contraindicated in",
      "Monitoring",
      "Members of this class",
    ]);
    const interactions = screen
      .getAllByTestId("relation-item")
      .filter((n) => within(n).queryByTestId("severity"));
    expect(interactions.map((n) => within(n).getByTestId("severity").textContent)).toContain(
      "Major",
    );
    expect(screen.getByText(/Hyperkalaemia; check potassium/)).toBeInTheDocument();
  });

  it("opens a source from a citation chip and follows a relation to its concept", async () => {
    const s = renderConcept("acei");
    const user = userEvent.setup();
    await screen.findByTestId("relations");
    const cough = screen
      .getAllByTestId("relation-item")
      .find((n) => within(n).queryByText("Dry cough"));
    expect(cough).toBeDefined();
    await user.click(within(cough as HTMLElement).getByTestId("cite-chip"));
    expect(s.openSource).toHaveBeenCalledWith(
      expect.objectContaining({ quote: expect.stringContaining("Dry cough affects") }),
    );
    await user.click(within(cough as HTMLElement).getByRole("link", { name: "Dry cough" }));
    expect(s.onOpenConcept).toHaveBeenCalledWith(id("cough"));
  });

  it("labels general knowledge and marks a concept reviewed", async () => {
    const s = renderConcept("lisinopril");
    const user = userEvent.setup();
    expect(
      await screen.findByText("Not from your notes", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Mark reviewed/ }));
    expect(await screen.findByText("Reviewed by you")).toBeInTheDocument();
    expect(s.store).toBeDefined();
  });

  it("opens where a concept appears: notes, questions and sources", async () => {
    const s = renderConcept("cough");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("mention"));
    expect(s.onOpenDocument).toHaveBeenCalledWith(
      expect.objectContaining({ blockId: expect.stringMatching(/^blk_/) }),
    );
    await user.click(screen.getByTestId("question-link"));
    expect(s.onOpenQuestion).toHaveBeenCalled();
    expect(screen.getAllByTestId("source-row").length).toBeGreaterThan(0);
  });

  it("shows a merge suggestion that she confirms before anything merges", async () => {
    renderConcept("metoprolol");
    const user = userEvent.setup();
    const suggestion = await screen.findByTestId("merge-suggestion");
    expect(suggestion).toHaveTextContent("Metoprolol succinate");
    await user.click(within(suggestion).getByRole("button", { name: "Merge into this concept" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(screen.queryByTestId("merge-suggestion")).not.toBeInTheDocument());
    expect(
      screen.getByText("Also called metoprolol tartrate, Metoprolol succinate"),
    ).toBeInTheDocument();
  });

  it("shows the neighbourhood as a list on a phone, filterable by relation", async () => {
    renderConcept("bb");
    const list = await screen.findByTestId("neighbour-list");
    expect(within(list).getByRole("link", { name: "Bradycardia" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Adverse effects", pressed: true }));
    await waitFor(() =>
      expect(within(list).queryByRole("link", { name: "Bradycardia" })).not.toBeInTheDocument(),
    );
    expect(
      within(list).getByRole("link", { name: "Cardioselective beta blockers" }),
    ).toBeInTheDocument();
  });

  it("has loading and error states", async () => {
    const slow = createMockConceptsStore({ delayMs: 50 });
    const { unmount } = render(
      <ConceptView {...setup(slow)} params={{ id: id("bb") }} search={new URLSearchParams()} />,
    );
    expect(screen.getByRole("status", { name: "Loading concept" })).toBeInTheDocument();
    await screen.findByTestId("concept-name");
    unmount();
    render(
      <ConceptView
        {...setup(createMockConceptsStore({ failWith: "Server down" }))}
        params={{ id: id("bb") }}
        search={new URLSearchParams()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
  });
});

function renderIndex(tab?: string, s = setup()) {
  window.innerWidth = 390;
  render(
    <ConceptsIndex
      {...s}
      params={{}}
      search={new URLSearchParams(tab ? { tab } : {})}
      drillRng={seededRng(5)}
    />,
  );
  return s;
}

describe("ConceptsIndex", () => {
  it("lists concepts alphabetically with type counts, and searches by brand", async () => {
    renderIndex();
    const user = userEvent.setup();
    const list = await screen.findByTestId("concept-list");
    const names = within(list)
      .getAllByTestId("concept-row")
      .map((r) => r.textContent ?? "");
    expect(names[0]).toContain("ACE inhibition");
    expect(screen.getByRole("button", { name: /^Drug 1\d/ })).toBeInTheDocument();
    await user.type(screen.getByTestId("concept-search"), "lopress");
    await waitFor(() => expect(screen.getAllByTestId("concept-row")).toHaveLength(1));
    expect(screen.getByTestId("concept-row")).toHaveTextContent("Metoprolol");
  });

  it("filters by type and says when nothing matches", async () => {
    renderIndex();
    const user = userEvent.setup();
    await screen.findByTestId("concept-list");
    await user.click(screen.getByRole("button", { name: /^Mechanism/ }));
    expect(screen.getAllByTestId("concept-row")).toHaveLength(5);
    await user.type(screen.getByTestId("concept-search"), "zzzz");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
  });

  it("explains an empty library", async () => {
    renderIndex(undefined, setup(createMockConceptsStore({ empty: true })));
    expect(await screen.findByText("No concepts yet")).toBeInTheDocument();
  });

  it("asks cross-course questions in plain words and shows the supporting sources", async () => {
    const s = renderIndex("find");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("question-causes"));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("button", { name: /Bradycardia/ }));
    const results = await screen.findAllByTestId("finder-result");
    const atenolol = results.find((r) => r.textContent?.includes("Atenolol"));
    expect(atenolol).toHaveTextContent("Through its class, Beta blockers");
    await user.click(within(atenolol as HTMLElement).getAllByTestId("cite-chip")[0] as HTMLElement);
    expect(s.openSource).toHaveBeenCalled();
    expect(screen.getByText("Everything that causes Bradycardia")).toBeInTheDocument();
  });

  it("builds a comparison table with sources in the cells and leaves a request", async () => {
    renderIndex("compare");
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: /Build table/ })).toBeDisabled();
    const addDrug = screen.getAllByRole("combobox")[0] as HTMLElement;
    for (const name of ["Atenolol", "Lisinopril"]) {
      await user.click(addDrug);
      await user.click(await screen.findByRole("button", { name: new RegExp(`^${name}`) }));
    }
    await user.click(screen.getByRole("button", { name: /Build table/ }));
    const table = await screen.findByTestId("comparison");
    expect(within(table).getAllByTestId("compare-row")).toHaveLength(2);
    expect(
      within(table).getByRole("columnheader", { name: "Adverse effects" }),
    ).toBeInTheDocument();
    expect(within(table).getAllByTestId("cite-chip").length).toBeGreaterThan(0);
    await user.click(
      screen.getByRole("button", { name: /Leave a request to add this to a study guide/ }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent("Drugs: Atenolol, Lisinopril");
  });

  it("adds a whole class to the comparison", async () => {
    renderIndex("compare");
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("combobox")[1] as HTMLElement);
    await user.click(await screen.findByRole("button", { name: /^ACE inhibitors/ }));
    await waitFor(() =>
      expect(within(screen.getByTestId("compare-drugs")).getAllByRole("listitem")).toHaveLength(3),
    );
  });
});

describe("Drill", () => {
  const partner = (prompt: string) => {
    const pair = brandPairs().find((p) => p.brand === prompt || p.generic === prompt);
    return pair?.brand === prompt ? pair.generic : pair?.brand;
  };

  it("plays a round with immediate feedback, then replays only the missed ones", async () => {
    renderIndex("drill");
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("start-round"));
    const prompts = () => screen.getAllByTestId("drill-prompt");
    expect(prompts()).toHaveLength(6);

    // one wrong pair first
    const firstPrompt = prompts()[0] as HTMLElement;
    const wrongAnswer = screen
      .getAllByTestId("drill-answer")
      .find((a) => a.textContent !== partner(firstPrompt.textContent ?? ""));
    await user.click(firstPrompt);
    await user.click(wrongAnswer as HTMLElement);
    expect(screen.getByTestId("drill-message")).toHaveTextContent("Not quite");
    expect(firstPrompt).toHaveAttribute("data-state", "wrong");

    // then everything right, tapping the answer first for half of them
    for (const [i, p] of prompts().entries()) {
      const want = partner(p.textContent ?? "");
      const tile = screen
        .getAllByTestId("drill-answer")
        .find((a) => a.textContent === want) as HTMLElement;
      if (i % 2 === 0) {
        await user.click(p);
        await user.click(tile);
      } else {
        await user.click(tile);
        await user.click(p);
      }
    }
    expect(await screen.findByTestId("drill-results")).toHaveTextContent(
      "5 of 6 right on the first try",
    );
    expect(screen.getByTestId("missed-list").children).toHaveLength(1);

    await user.click(screen.getByTestId("missed-again"));
    expect(screen.getAllByTestId("drill-prompt")).toHaveLength(1);
    expect(screen.getByTestId("drill-progress")).toHaveTextContent("0 of 1 matched");
  });
});
