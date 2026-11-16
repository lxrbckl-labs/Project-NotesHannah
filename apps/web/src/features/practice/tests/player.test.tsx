import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Player } from "../screens/Player";
import type { AnswerKey } from "../store/key";
import { newStore } from "./fixtures";

async function rightOption(store: ReturnType<typeof newStore>, sessionId: string, index: number) {
  const key = store.debugKey(sessionId, index) as Extract<AnswerKey, { type: "multiple_choice" }>;
  return key.correct;
}

function setup(length = 3) {
  const store = newStore();
  const props = { onExit: vi.fn(), onFinished: vi.fn(), onOpenSource: vi.fn() };
  return {
    store,
    props,
    start: () =>
      store.startSession({ scope: { kind: "all" }, formats: ["multiple_choice"], length }),
  };
}

test("one question at a time: answer, feedback with sources, next, then results", async () => {
  const user = userEvent.setup();
  const { store, props, start } = setup(2);
  const s = await start();
  render(<Player store={store} sessionId={s.id} {...props} />);
  expect(await screen.findByTestId("position")).toHaveTextContent("Question 1 of 2");
  expect(screen.getByTestId("submit")).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: await rightOption(store, s.id, 0) }));
  await user.click(screen.getByTestId("submit"));
  const feedback = await screen.findByTestId("feedback");
  expect(feedback).toHaveAttribute("data-correct", "true");
  expect(screen.getByTestId("announcer")).toHaveTextContent("Correct");
  // citation chips call onOpenSource
  await user.click(screen.getAllByTestId("source-chip")[0] as HTMLElement);
  expect(props.onOpenSource).toHaveBeenCalledTimes(1);
  expect(props.onOpenSource.mock.calls[0]?.[0]).toMatchObject({
    label: expect.stringMatching(/^Lecture \d, page \d+$/),
  });
  await user.click(screen.getByTestId("next"));
  expect(await screen.findByText("Question 2 of 2")).toBeInTheDocument();
  expect(screen.queryByTestId("feedback")).toBeNull();
  // a wrong answer: the correct answer and the reason are announced
  const wrong = store.bank.find(
    (q) => q.id === (screen.getByTestId("player").dataset.questionId as string),
  );
  const key = store.debugKey(s.id, 1) as Extract<AnswerKey, { type: "multiple_choice" }>;
  await user.click(screen.getByRole("radio", { name: key.wrong }));
  await user.click(screen.getByTestId("submit"));
  expect((await screen.findByTestId("feedback")).dataset.correct).toBe("false");
  expect(screen.getByTestId("announcer")).toHaveTextContent(/Not quite. Correct answer:/);
  expect(screen.getByTestId("feedback")).toHaveTextContent(/The correct answer is/);
  expect(wrong).toBeDefined();
  expect(screen.getByTestId("notebook-note")).toHaveTextContent(/notebook/i);
  await user.click(screen.getByRole("button", { name: "See results" }));
  await waitFor(() => expect(props.onFinished).toHaveBeenCalledTimes(1));
  expect(props.onFinished.mock.calls[0]?.[0].items).toHaveLength(2);
});

test("Enter checks and continues from the keyboard", async () => {
  const user = userEvent.setup();
  const { store, props, start } = setup(2);
  const s = await start();
  render(<Player store={store} sessionId={s.id} {...props} />);
  await screen.findByTestId("position");
  const first = await rightOption(store, s.id, 0);
  await user.keyboard("{Enter}"); // nothing chosen yet: nothing happens
  expect(screen.queryByTestId("feedback")).toBeNull();
  await user.click(screen.getByRole("radio", { name: first }));
  await user.keyboard("{Enter}");
  expect(await screen.findByTestId("feedback")).toBeInTheDocument();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Question 2 of 2")).toBeInTheDocument();
});

test("leaving asks first; keep going stays, leave exits with the session still open", async () => {
  const user = userEvent.setup();
  const { store, props, start } = setup();
  const s = await start();
  render(<Player store={store} sessionId={s.id} {...props} />);
  await screen.findByTestId("position");
  await user.click(screen.getByTestId("leave"));
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("Leave this session?");
  await user.click(screen.getByRole("button", { name: "Keep going" }));
  expect(props.onExit).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("leave"));
  await user.click(await screen.findByRole("button", { name: "Leave" }));
  expect(props.onExit).toHaveBeenCalledTimes(1);
  expect((await store.getUnfinishedSession())?.id).toBe(s.id);
});

test("pause hides the question and stops; resume brings it back", async () => {
  const user = userEvent.setup();
  const { store, props, start } = setup();
  const s = await start();
  render(<Player store={store} sessionId={s.id} {...props} />);
  await screen.findByTestId("position");
  await user.click(screen.getByTestId("pause"));
  expect(screen.getByRole("dialog", { name: "Paused" })).toBeInTheDocument();
  expect(screen.getByTestId("player")).toHaveAttribute("aria-hidden", "true");
  await user.click(screen.getByTestId("resume"));
  expect(screen.queryByRole("dialog", { name: "Paused" })).toBeNull();
  expect(screen.getByTestId("player")).toHaveAttribute("aria-hidden", "false");
});

test("skip moves on; a skipped question comes back at the end", async () => {
  const user = userEvent.setup();
  const { store, props, start } = setup(2);
  const s = await start();
  render(<Player store={store} sessionId={s.id} {...props} />);
  await screen.findByText("Question 1 of 2");
  await user.click(screen.getByTestId("skip"));
  expect(await screen.findByText("Question 2 of 2")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: await rightOption(store, s.id, 1) }));
  await user.click(screen.getByTestId("submit"));
  await user.click(await screen.findByTestId("next"));
  // back to the skipped one, with no further skip
  expect(await screen.findByText("Question 1 of 2")).toBeInTheDocument();
  expect(screen.queryByTestId("skip")).toBeNull();
});

test("resume: a new player on the same session picks up where the first stopped", async () => {
  const user = userEvent.setup();
  const { store, props, start } = setup(3);
  const s = await start();
  const first = render(<Player store={store} sessionId={s.id} {...props} />);
  await screen.findByTestId("position");
  await user.click(screen.getByRole("radio", { name: await rightOption(store, s.id, 0) }));
  await user.click(screen.getByTestId("submit"));
  await screen.findByTestId("feedback");
  first.unmount();
  render(<Player store={store} sessionId={s.id} {...props} />);
  expect(await screen.findByText("Question 2 of 3")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "1 of 3 answered" })).toBeInTheDocument();
});

test("a self-graded flashcard flow: show answer, rate, feedback, next", async () => {
  const user = userEvent.setup();
  const store = newStore();
  const props = { onExit: vi.fn(), onFinished: vi.fn() };
  const s = await store.startSession({ scope: { kind: "all" }, formats: ["flashcard"], length: 2 });
  render(<Player store={store} sessionId={s.id} {...props} />);
  await user.click(await screen.findByRole("button", { name: "Show answer" }));
  await user.click(await screen.findByTestId("rate-good"));
  expect(await screen.findByTestId("feedback")).toHaveTextContent("Marked as recalled");
  expect(screen.queryByTestId("submit")).toBeNull();
  await user.click(screen.getByTestId("next"));
  expect(await screen.findByText("Question 2 of 2")).toBeInTheDocument();
});

test("a free response is self-graded by ticking the rubric", async () => {
  const user = userEvent.setup();
  const store = newStore();
  const props = { onExit: vi.fn(), onFinished: vi.fn() };
  const s = await store.startSession({
    scope: { kind: "all" },
    formats: ["free_response"],
    length: 1,
  });
  render(<Player store={store} sessionId={s.id} {...props} />);
  await user.type(await screen.findByLabelText("Your answer"), "my words");
  await user.click(screen.getByRole("button", { name: "Show model answer" }));
  const boxes = await screen.findAllByRole("checkbox");
  for (const b of boxes) await user.click(b);
  await user.click(screen.getByTestId("submit-self"));
  expect(await screen.findByTestId("feedback")).toHaveAttribute("data-correct", "true");
  expect(screen.getByRole("button", { name: "See results" })).toBeInTheDocument();
});

test("a session with no questions left goes straight to results", async () => {
  const { store, props, start } = setup(1);
  const s = await start();
  await store.skip(s.id, 0);
  await store.finishSession(s.id);
  render(<Player store={store} sessionId={s.id} {...props} />);
  await waitFor(() => expect(props.onFinished).toHaveBeenCalled());
});
