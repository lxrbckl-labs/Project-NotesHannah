import type { RequestTarget } from "@notes/schema";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AskButton } from "../AskButton";
import { KINDS_FOR_TARGET } from "../model/wording";
import { RequestComposer } from "../RequestComposer";
import { RequestsBadge } from "../RequestsBadge";
import { RequestsView } from "../RequestsView";
import { createMockRequestsStore } from "../store/mock";
import { bid, did, fid, nid, pgid, qid } from "../store/seed";

const NOW = Date.parse("2026-11-15T10:00:00Z");
const TARGETS: Array<[string, RequestTarget]> = [
  ["library", { type: "library" }],
  ["node", { type: "node", nodeId: nid(1) }],
  ["document", { type: "document", documentId: did(1) }],
  ["block", { type: "block", documentId: did(1), blockId: bid(1) }],
  ["source", { type: "source", fileId: fid(1), pageId: pgid(12) }],
  ["question", { type: "question", questionId: qid(1) }],
];

function fakeSubmit() {
  return vi.fn(async (input) => {
    const store = createMockRequestsStore({ now: () => NOW, empty: true });
    return store.create(input);
  });
}

describe("RequestComposer", () => {
  it.each(TARGETS)("leaves a quick action for a %s target", async (name, target) => {
    const user = userEvent.setup();
    const submit = fakeSubmit();
    const onCreated = vi.fn();
    render(
      <RequestComposer
        open
        onOpenChange={() => {}}
        target={target}
        targetLabel={`The ${name}`}
        submit={submit}
        onCreated={onCreated}
      />,
    );
    expect(screen.getByTestId("composer-target")).toHaveTextContent(`The ${name}`);
    const kinds = KINDS_FOR_TARGET[target.type];
    expect(screen.getAllByTestId(/^kind-/)).toHaveLength(kinds.length);
    expect(screen.getByRole("button", { name: "Leave request" })).toBeDisabled();
    await user.click(screen.getByTestId(`kind-${kinds[0]}`));
    expect(screen.getByTestId(`kind-${kinds[0]}`)).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Leave request" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(submit).toHaveBeenCalledWith({ target, kind: kinds[0], message: "" });
    expect(await screen.findByTestId("composer-done")).toHaveTextContent("next time one runs");
  });

  it("leaves free text as kind other, and examples fill the box", async () => {
    const user = userEvent.setup();
    const submit = fakeSubmit();
    render(
      <RequestComposer open onOpenChange={() => {}} target={{ type: "library" }} submit={submit} />,
    );
    await user.click(screen.getAllByTestId("example")[0] as HTMLElement);
    const box = screen.getByTestId("message") as HTMLTextAreaElement;
    expect(box.value.length).toBeGreaterThan(10);
    await user.clear(box);
    await user.type(box, "Make a plan for Friday");
    await user.click(screen.getByRole("button", { name: "Leave request" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        target: { type: "library" },
        kind: "other",
        message: "Make a plan for Friday",
      }),
    );
  });

  it("starts from what the caller presets and says nothing happens until an agent runs", () => {
    render(
      <RequestComposer
        open
        onOpenChange={() => {}}
        target={{ type: "library" }}
        defaultKind="summarise"
        defaultMessage="Compare atenolol and metoprolol"
        submit={fakeSubmit()}
      />,
    );
    expect(screen.getByTestId("kind-summarise")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("message")).toHaveValue("Compare atenolol and metoprolol");
    expect(screen.getByText(/next time one runs/)).toBeInTheDocument();
  });

  it("shows the server's message when leaving fails, and keeps the text", async () => {
    const user = userEvent.setup();
    const store = createMockRequestsStore({ failWith: "Server is asleep." });
    render(
      <RequestComposer
        open
        onOpenChange={() => {}}
        target={{ type: "library" }}
        defaultMessage="Hello"
        submit={store.create}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Leave request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server is asleep.");
    expect(screen.getByTestId("message")).toHaveValue("Hello");
  });
});

describe("AskButton", () => {
  it("opens the composer for its target", async () => {
    const user = userEvent.setup();
    render(
      <AskButton
        target={{ type: "question", questionId: qid(1) }}
        targetLabel="Question 14"
        submit={fakeSubmit()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Ask an agent about Question 14" }));
    expect(screen.getByRole("dialog", { name: "Ask an agent" })).toBeInTheDocument();
    expect(screen.getByTestId("composer-target")).toHaveTextContent("Question 14");
  });
});

describe("RequestsView", () => {
  const make = () => createMockRequestsStore({ now: () => NOW });
  const props = (store: ReturnType<typeof make>) => ({
    store,
    openSource: vi.fn(),
    openNode: vi.fn(),
    onOpenDocument: vi.fn(),
    onOpenQuestion: vi.fn(),
    onOpenConcept: vi.fn(),
  });

  it("lists requests newest first with plain-word status", async () => {
    localStorage.clear();
    render(<RequestsView {...props(make())} />);
    const cards = await screen.findAllByTestId("request-card");
    expect(cards.length).toBe(11);
    // The "agents pick these up" note is said in the composer only (Alex, 2026-11-17), not on the list.
    expect(screen.queryByText(/Agents pick these up the next time one runs/)).toBeNull();
    const first = cards[0] as HTMLElement;
    expect(within(first).getByTestId("status")).toHaveTextContent("Waiting for an agent");
    expect(screen.getAllByText("An agent is working on it").length).toBeGreaterThan(0);
  });

  it("filters by status and shows counts", async () => {
    const user = userEvent.setup();
    render(<RequestsView {...props(make())} />);
    await screen.findAllByTestId("request-card");
    expect(screen.getByTestId("filter-cancelled")).toHaveTextContent("1");
    await user.click(screen.getByTestId("filter-done"));
    await waitFor(() => {
      const cards = screen.getAllByTestId("request-card");
      expect(cards.length).toBe(6);
      for (const card of cards) expect(card).toHaveAttribute("data-status", "done");
    });
    await user.click(screen.getByTestId("filter-cancelled"));
    await waitFor(() => expect(screen.getAllByTestId("request-card")).toHaveLength(1));
  });

  it("says calmly when a reply has figures that are not in her notes", async () => {
    render(<RequestsView {...props(make())} />);
    await screen.findAllByTestId("request-card");
    const note = screen.getByTestId("unsourced-figures");
    expect(note).toHaveTextContent("Contains figures not found in your notes: 40 mg daily");
    expect(screen.getAllByTestId("reply").length).toBeGreaterThan(1);
  });

  it("opens the target and the links in a reply", async () => {
    const user = userEvent.setup();
    const p = props(make());
    render(<RequestsView {...p} />);
    await screen.findAllByTestId("request-card");
    await user.click(screen.getAllByTestId("open-target")[0] as HTMLElement);
    expect(p.onOpenDocument).toHaveBeenCalled();
    const links = screen.getAllByTestId("reply-link");
    await user.click(links.find((l) => l.dataset.type === "source") as HTMLElement);
    expect(p.openSource).toHaveBeenCalledWith({ fileId: fid(1), pageId: pgid(12) });
    await user.click(links.find((l) => l.dataset.type === "concept") as HTMLElement);
    expect(p.onOpenConcept).toHaveBeenCalled();
    await user.click(links.find((l) => l.dataset.type === "question") as HTMLElement);
    expect(p.onOpenQuestion).toHaveBeenCalled();
  });

  it("edits a waiting request, cancels one, and reopens an answer with a note", async () => {
    const user = userEvent.setup();
    const store = make();
    render(<RequestsView {...props(store)} />);
    const waiting = (await screen.findAllByTestId("request-card")).filter(
      (c) => c.dataset.status === "waiting",
    );
    await user.click(within(waiting[0] as HTMLElement).getByTestId("edit"));
    const box = await screen.findByTestId("message");
    await user.clear(box);
    await user.type(box, "Atenolol is hydrophilic");
    await user.click(screen.getByTestId("save-edit"));
    expect(await screen.findByText("Atenolol is hydrophilic")).toBeInTheDocument();

    await user.click(within(waiting[1] as HTMLElement).getByTestId("cancel"));
    await user.click(await screen.findByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(screen.getByTestId("filter-cancelled")).toHaveTextContent("2"));

    const done = screen.getAllByTestId("request-card").find((c) => c.dataset.status === "done");
    await user.click(within(done as HTMLElement).getByTestId("reopen"));
    await user.type(await screen.findByTestId("message"), "Still missing the table");
    await user.click(screen.getByTestId("confirm-reopen"));
    await waitFor(() => expect(store.calls.some((c) => c[0] === "reopen")).toBe(true));
    expect(store.calls.find((c) => c[0] === "reopen")?.[2]).toBe("Still missing the table");
  });

  it("shows the history of a reopened request", async () => {
    const user = userEvent.setup();
    render(<RequestsView {...props(make())} />);
    await screen.findAllByTestId("request-card");
    await user.click(screen.getByTestId("history-toggle"));
    expect(screen.getByTestId("history")).toHaveTextContent(
      "The explanation still says atenolol only.",
    );
  });

  it("has loading, empty and error states", async () => {
    const empty = render(<RequestsView {...props(createMockRequestsStore({ empty: true }))} />);
    expect(await screen.findByText("No requests yet")).toBeInTheDocument();
    empty.unmount();
    render(<RequestsView {...props(createMockRequestsStore({ failWith: "Down for lunch." }))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Down for lunch.");
  });

  it("marks unread answers as new once, and the badge falls", async () => {
    localStorage.clear();
    const store = make();
    const badge = render(<RequestsBadge store={store} />);
    await waitFor(() => expect(screen.getByTestId("requests-badge")).toHaveTextContent("10"));
    badge.unmount();
    render(<RequestsView {...props(store)} />);
    await screen.findAllByTestId("request-card");
    await waitFor(() =>
      expect(screen.getAllByTestId("request-card").some((c) => c.dataset.unread)).toBe(true),
    );
    render(<RequestsBadge store={store} />);
    await waitFor(() => expect(screen.getByTestId("requests-badge")).toHaveTextContent("3"));
  });
});
