import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ExamPlanner, UpcomingExamsCard } from "../../exams";
import type { PickedNode } from "../../exams/types";
import { PracticeApp } from "../PracticeApp";
import { Cards } from "../screens/Cards";
import { Notebook } from "../screens/Notebook";
import { Results } from "../screens/Results";
import { Start } from "../screens/Start";
import { WeakAreas } from "../screens/WeakAreas";
import { NODE_COURSE, NODE_L7, NODE_L8, NODES } from "../store/bank";
import { buildAnswer } from "../store/key";
import type { Answer } from "../types";
import { newStore } from "./fixtures";

const picked = (...ids: string[]): PickedNode[] =>
  NODES.filter((n) => ids.includes(n.id)).map(({ id, title, path }) => ({ id, title, path }));

test("start: defaults to where she is, every type on, one tap starts", async () => {
  const user = userEvent.setup();
  const store = newStore("demo");
  const onStarted = vi.fn();
  render(
    <Start
      store={store}
      currentNodeId={NODE_L7}
      onStarted={onStarted}
      onResume={vi.fn()}
      onOpenView={vi.fn()}
    />,
  );
  const start = await screen.findByTestId("start-session");
  expect(start).toHaveTextContent("Start 10 questions");
  expect(screen.getByRole("radio", { name: /Lecture 7: Beta-blockers/ })).toBeChecked();
  expect(screen.getByTestId("due-today")).toHaveTextContent(/\d/);
  expect(screen.getByTestId("notebook-size")).not.toHaveTextContent("0");
  expect(screen.getByTestId("format-flashcard")).toHaveAttribute("aria-pressed", "true");
  await user.click(start);
  await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  const session = onStarted.mock.calls[0]?.[0];
  expect(session.total).toBe(10);
  expect(session.scopeLabel).toBe("Lecture 7: Beta-blockers");
});

test("start: choosing formats and a scope changes what is offered", async () => {
  const user = userEvent.setup();
  const store = newStore("demo");
  const onStarted = vi.fn();
  render(
    <Start
      store={store}
      currentNodeId={NODE_L7}
      onStarted={onStarted}
      onResume={vi.fn()}
      onOpenView={vi.fn()}
    />,
  );
  await screen.findByTestId("start-session");
  // turn everything but calculations off
  for (const t of [
    "multiple_choice",
    "select_all",
    "matching",
    "fill_blank",
    "flashcard",
    "case",
    "free_response",
  ]) {
    await user.click(screen.getByTestId(`format-${t}`));
  }
  expect(screen.getByTestId("start-session")).toHaveTextContent("Start 3 questions");
  await user.click(screen.getByRole("radio", { name: /Lecture 8/ }));
  // choosing a scope puts every available type back on
  expect(screen.getByTestId("start-session")).toHaveTextContent("Start 10 questions");
  await user.click(screen.getByRole("radio", { name: /Flashcards due today/ }));
  expect(screen.queryByTestId("format-calculation")).toBeNull();
  await user.click(screen.getByTestId("start-session"));
  await waitFor(() => expect(onStarted).toHaveBeenCalled());
  expect(
    onStarted.mock.calls[0]?.[0].items.every((i: { type: string }) => i.type === "flashcard"),
  ).toBe(true);
});

test("start: an unfinished session is offered for resuming", async () => {
  const user = userEvent.setup();
  const store = newStore();
  const s = await store.startSession({
    scope: { kind: "all" },
    formats: ["multiple_choice"],
    length: 3,
  });
  const onResume = vi.fn();
  render(<Start store={store} onStarted={vi.fn()} onResume={onResume} onOpenView={vi.fn()} />);
  await user.click(await screen.findByTestId("resume-session"));
  expect(onResume).toHaveBeenCalledWith(s.id);
});

async function finishedSession(store: ReturnType<typeof newStore>) {
  const s = await store.startSession({
    scope: { kind: "all" },
    formats: ["multiple_choice", "fill_blank", "calculation"],
    length: 6,
  });
  let state = s;
  const modes = ["right", "wrong", "right", "wrong", "right", "wrong"] as const;
  for (const mode of modes) {
    const cur = state.current;
    if (!cur) break;
    const q = store.bank.find((b) => b.id === cur.questionId);
    if (!q) break;
    const key = store.debugKey(s.id, cur.index);
    let answer: Answer;
    if (key.type === "multiple_choice" && q.type === "multiple_choice") {
      const text = mode === "right" ? key.correct : key.wrong;
      answer = {
        type: "multiple_choice" as const,
        optionId: q.options.find((o) => o.text === text)?.id as string,
      };
    } else if (key.type === "fill_blank") {
      answer = { type: "fill_blank" as const, blanks: mode === "right" ? key.correct : key.wrong };
    } else if (key.type === "calculation") {
      const v = mode === "right" ? key.correct : key.slip;
      answer = { type: "calculation" as const, response: v.value, unit: v.unit };
    } else throw new Error("unexpected");
    await store.submitAnswer(s.id, cur.index, answer, 9000);
    state = await store.getSession(s.id);
  }
  return store.finishSession(s.id);
}

test("results: score, time, per-question outcomes, notebook and next steps", async () => {
  const user = userEvent.setup();
  const store = newStore();
  const results = await finishedSession(store);
  const onRetry = vi.fn();
  const onOpenSource = vi.fn();
  render(
    <Results
      store={store}
      results={results}
      onRetryMissed={onRetry}
      onPracticeScope={vi.fn()}
      onDone={vi.fn()}
      onOpenNotebook={vi.fn()}
      onOpenSource={onOpenSource}
    />,
  );
  expect(screen.getByTestId("score")).toHaveTextContent("3 of 6");
  expect(screen.getByText("50% right")).toBeInTheDocument();
  expect(screen.getByText("Time")).toBeInTheDocument();
  expect(screen.getByText("54 s")).toBeInTheDocument();
  expect(screen.getByTestId("notebook-added-count")).toHaveTextContent(
    "3 questions were added or kept",
  );
  const retry = screen.getByTestId("retry-missed");
  expect(retry).toHaveTextContent("Retry the 3 I missed");
  await user.click(retry);
  expect(onRetry).toHaveBeenCalled();
  // each question can be reviewed with its answer, result and sources
  await user.click(within(screen.getByTestId("review-0")).getByRole("button"));
  expect(within(screen.getByTestId("review-0")).getByTestId("feedback")).toBeInTheDocument();
  await user.click(
    within(screen.getByTestId("review-0")).getAllByTestId("source-chip")[0] as HTMLElement,
  );
  expect(onOpenSource).toHaveBeenCalled();
});

test("notebook: why each is there and how it leaves; retry one or all", async () => {
  const user = userEvent.setup();
  const store = newStore("demo");
  const onStarted = vi.fn();
  render(<Notebook store={store} onStarted={onStarted} />);
  const rows = await screen.findAllByTestId("notebook-row");
  expect(rows.length).toBeGreaterThan(2);
  expect(within(rows[0] as HTMLElement).getByText("Why it is here")).toBeInTheDocument();
  expect(within(rows[0] as HTMLElement).getByText("How it leaves")).toBeInTheDocument();
  expect(screen.getAllByText(/Answer it correctly/).length).toBe(rows.length);
  await user.click(within(rows[0] as HTMLElement).getByTestId("retry-one"));
  await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  expect(onStarted.mock.calls[0]?.[0].total).toBe(1);
  await user.click(screen.getByTestId("retry-all"));
  await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(2));
  expect(onStarted.mock.calls[1]?.[0].total).toBe(rows.length);
});

test("notebook: empty state is encouraging, not empty", async () => {
  render(<Notebook store={newStore()} onStarted={vi.fn()} />);
  expect(await screen.findByText("Your notebook is empty")).toBeInTheDocument();
  expect(screen.queryByTestId("retry-all")).toBeNull();
});

test("weak areas: honest 'not enough attempts yet' and factual accuracy, no gamification", async () => {
  const store = newStore("demo");
  render(<WeakAreas store={store} onStarted={vi.fn()} />);
  await screen.findByText("Weak areas");
  expect(screen.getByText(/at least 5 answers across 3 different questions/)).toBeInTheDocument();
  const cards = await screen.findAllByTestId("area-card");
  const statuses = new Set(cards.map((c) => c.dataset.status));
  expect(statuses.has("insufficient_data")).toBe(true);
  expect(screen.getAllByTestId("insufficient")[0]).toHaveTextContent(
    /Not enough attempts yet: \d+ answers? on \d+ questions?/,
  );
  expect(document.body.textContent).not.toMatch(/streak|badge|level up|points earned|congrat/i);
  const meter = screen.queryAllByRole("progressbar")[0];
  if (meter) expect(Number(meter.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(0);
});

test("weak areas: nothing yet says so plainly", async () => {
  render(<WeakAreas store={newStore()} onStarted={vi.fn()} />);
  expect(await screen.findByText("Nothing to show yet")).toBeInTheDocument();
});

test("flashcard deck: due today, two weeks upcoming, start review", async () => {
  const user = userEvent.setup();
  const store = newStore("demo");
  const onStarted = vi.fn();
  render(<Cards store={store} onStarted={onStarted} />);
  const today = await screen.findByTestId("cards-due-today");
  const due = await store.getDueByDay();
  expect(today).toHaveTextContent(String(due.today));
  const chart = screen.getByTestId("due-chart");
  expect(chart.querySelectorAll("[data-count]")).toHaveLength(14);
  // a text alternative for the chart
  expect(within(chart).getAllByRole("row")).toHaveLength(15);
  await user.click(screen.getByTestId("start-review"));
  await waitFor(() => expect(onStarted).toHaveBeenCalled());
  expect(onStarted.mock.calls[0]?.[0].total).toBe(due.today);
});

test("exam planner: create an exam with coverage picked through pickNodes", async () => {
  const user = userEvent.setup();
  const store = newStore();
  const pickNodes = vi.fn().mockResolvedValue(picked(NODE_L7, NODE_L8));
  const onPractice = vi.fn();
  render(<ExamPlanner api={store} pickNodes={pickNodes} onPractice={onPractice} />);
  expect(await screen.findByText("No exams yet")).toBeInTheDocument();
  await user.click(screen.getByTestId("add-exam"));
  await user.click(await screen.findByTestId("exam-save"));
  expect(screen.getByText("Name the course.")).toBeInTheDocument();
  expect(screen.getByText("Choose at least one lecture or folder.")).toBeInTheDocument();
  await user.type(screen.getByTestId("exam-course"), "Cardiovascular Pharmacology");
  await user.type(screen.getByTestId("exam-title"), "Midterm");
  fireEvent.change(screen.getByTestId("exam-date"), { target: { value: "2026-11-30" } });
  await user.click(screen.getByTestId("exam-choose"));
  expect(pickNodes).toHaveBeenCalledWith(expect.objectContaining({ selected: [] }));
  expect(await screen.findByText("Lecture 8: ACE inhibitors")).toBeInTheDocument();
  await user.click(screen.getByTestId("exam-save"));
  const card = await screen.findByTestId("exam-card");
  expect(within(card).getByText("Midterm")).toBeInTheDocument();
  expect(within(card).getByTestId("days-remaining")).toHaveTextContent("In 15 days");
  expect(within(card).getByText(/Lecture 7: Beta-blockers · /)).toBeInTheDocument();
  await user.click(within(card).getByTestId("practise-exam"));
  expect(onPractice).toHaveBeenCalledWith((await store.listExams())[0]?.id);
});

test("exam planner: editing coverage removes a lecture and adds another", async () => {
  const user = userEvent.setup();
  const store = newStore();
  const exam = await store.createExam({
    course: "Cardiovascular Pharmacology",
    title: "Quiz",
    date: "2026-11-20",
    nodeIds: [NODE_L7, NODE_L8],
  });
  const pickNodes = vi.fn().mockResolvedValue(picked(NODE_COURSE));
  render(<ExamPlanner api={store} pickNodes={pickNodes} onPractice={vi.fn()} />);
  await user.click(await screen.findByTestId("edit-exam"));
  const chips = await screen.findByRole("list", { name: "Covered lectures and folders" });
  expect(within(chips).getAllByRole("listitem")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Remove Lecture 8: ACE inhibitors" }));
  expect(within(chips).getAllByRole("listitem")).toHaveLength(1);
  await user.click(screen.getByTestId("exam-save"));
  await waitFor(async () => expect((await store.listExams())[0]?.nodeIds).toEqual([NODE_L7]));
  // change coverage through the picker; it was handed the current selection
  await user.click(await screen.findByTestId("edit-exam"));
  await user.click(screen.getByTestId("exam-choose"));
  expect(pickNodes).toHaveBeenCalledWith(expect.objectContaining({ selected: [NODE_L7] }));
  await user.click(await screen.findByTestId("exam-save"));
  await waitFor(async () => expect((await store.listExams())[0]?.nodeIds).toEqual([NODE_COURSE]));
  expect((await store.listExams())[0]?.id).toBe(exam.id);
  // delete asks first
  await user.click(await screen.findByRole("button", { name: "Delete Quiz" }));
  await user.click(await screen.findByRole("button", { name: "Delete exam" }));
  await waitFor(async () => expect(await store.listExams()).toHaveLength(0));
});

test("home card: upcoming exams with days remaining and progress; past exams are left out", async () => {
  const user = userEvent.setup();
  const store = newStore("demo");
  await store.createExam({
    course: "Cardio",
    title: "Old one",
    date: "2026-11-01",
    nodeIds: [NODE_L7],
  });
  const onPractice = vi.fn();
  render(<UpcomingExamsCard api={store} onPractice={onPractice} />);
  const items = await screen.findAllByTestId("upcoming-exam");
  expect(items).toHaveLength(2);
  expect(within(items[0] as HTMLElement).getByTestId("days-remaining")).toHaveTextContent(
    "In 3 days",
  );
  expect(within(items[1] as HTMLElement).getByTestId("days-remaining")).toHaveTextContent(
    "In 12 days",
  );
  expect(within(items[0] as HTMLElement).getByTestId("exam-progress")).toHaveTextContent(
    /Practised \d+ of \d+ questions/,
  );
  expect(screen.queryByText("Old one")).toBeNull();
  await user.click(
    within(items[0] as HTMLElement).getByRole("button", { name: "Practise for this" }),
  );
  expect(onPractice).toHaveBeenCalled();
});

test("the whole app: start, answer, results, retry missed until the notebook is empty", async () => {
  const user = userEvent.setup();
  const store = newStore();
  render(<PracticeApp store={store} currentNodeId={NODE_L7} pickNodes={async () => null} />);
  await screen.findByTestId("format-multiple_choice");
  for (const t of [
    "select_all",
    "matching",
    "fill_blank",
    "calculation",
    "flashcard",
    "case",
    "free_response",
  ]) {
    await user.click(screen.getByTestId(`format-${t}`));
  }
  // multiple choice only: the four there are
  await user.click(screen.getByTestId("start-session"));
  await screen.findByTestId("player");

  const answerAll = async (mode: "right" | "wrong") => {
    for (;;) {
      const player = screen.queryByTestId("player");
      if (!player) return;
      const id = player.dataset.session as string;
      const index = Number(player.dataset.index);
      const key = store.debugKey(id, index);
      if (key.type !== "multiple_choice") throw new Error("expected multiple choice");
      await user.click(
        screen.getByRole("radio", { name: mode === "right" ? key.correct : key.wrong }),
      );
      await user.click(screen.getByTestId("submit"));
      await screen.findByTestId("feedback");
      const next = screen.getByTestId("next");
      const last = next.textContent === "See results";
      await user.click(next);
      if (last) return;
      await screen.findByText(new RegExp(`Question ${index + 2} of`));
    }
  };
  await answerAll("wrong");
  expect(await screen.findByTestId("score")).toHaveTextContent("0 of 4");
  expect(screen.getByTestId("notebook-added-count")).toHaveTextContent("4 questions");
  // retry the missed ones, this time getting them right: the notebook empties
  await user.click(screen.getByTestId("retry-missed"));
  await screen.findByTestId("player");
  await answerAll("right");
  expect(await screen.findByTestId("score")).toHaveTextContent("4 of 4");
  expect(await store.listNotebook()).toHaveLength(0);
  await user.click(screen.getByTestId("done"));
  await user.click(await screen.findByTestId("nav-notebook"));
  expect(await screen.findByText("Your notebook is empty")).toBeInTheDocument();
});

test("buildAnswer is consistent with what the player submits (sanity)", () => {
  const q = newStore().bank.find((b) => b.type === "multiple_choice");
  if (q?.type !== "multiple_choice") throw new Error();
  expect(buildAnswer(q, 1, "right").type).toBe("multiple_choice");
});
