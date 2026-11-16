import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { practice } from "@notes/schema";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  Calculation,
  Case,
  type CaseDraft,
  FillBlank,
  Flashcard,
  FreeResponse,
  Matching,
  MultipleChoice,
  SelectAll,
} from "../answers";
import { buildAnswer } from "../store/key";
import type {
  ServedCalculation,
  ServedCase,
  ServedFillBlank,
  ServedFlashcard,
  ServedFreeResponse,
  ServedMatching,
  ServedMultipleChoice,
  ServedSelectAll,
} from "../types";
import { find, graded, SEEDS, serve } from "./fixtures";

/** Holds the draft the way the player does and spies on every change. */
function Stateful<T>({
  children,
  spy,
  initial = null,
}: {
  children: (value: T | null, set: (v: T | null) => void) => ReactNode;
  spy?: (v: T | null) => void;
  initial?: T | null;
}) {
  const [v, setV] = useState<T | null>(initial);
  return children(v, (next) => {
    setV(next);
    spy?.(next);
  });
}

describe("multiple choice", () => {
  const q = serve("multiple_choice", "cardioselective") as ServedMultipleChoice;
  const rightText = "It blocks mainly beta-1 receptors in the heart";

  test("renders the stripped question and builds { optionId }", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Stateful spy={spy}>
        {(v, set) => <MultipleChoice question={q} value={v as never} onChange={set as never} />}
      </Stateful>,
    );
    expect(screen.getByText(/called cardioselective/)).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(q.options.length);
    expect(document.querySelector("[data-state]:not([data-state=idle])")).toBeNull();
    await user.click(screen.getByRole("radio", { name: rightText }));
    const id = q.options.find((o) => o.text === rightText)?.id;
    expect(spy).toHaveBeenLastCalledWith({ type: "multiple_choice", optionId: id });
    expect(screen.getByRole("radio", { name: rightText })).toBeChecked();
  });

  test("keyboard: a letter or digit chooses that option", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<MultipleChoice question={q} value={null} onChange={spy} />);
    await user.keyboard("c");
    expect(spy).toHaveBeenLastCalledWith({ type: "multiple_choice", optionId: q.options[2]?.id });
    await user.keyboard("2");
    expect(spy).toHaveBeenLastCalledWith({ type: "multiple_choice", optionId: q.options[1]?.id });
  });

  test("shows right and wrong after grading, and is read-only", () => {
    const wrongId = q.options.find((o) => o.text !== rightText)?.id as string;
    const result = graded("multiple_choice", "cardioselective", {
      type: "multiple_choice",
      optionId: wrongId,
    });
    // ids come from the bank; the served ids are the same ones
    const { container } = render(
      <MultipleChoice
        question={q}
        value={{ type: "multiple_choice", optionId: wrongId }}
        onChange={() => undefined}
        disabled
        result={result}
      />,
    );
    expect(container.querySelectorAll('[data-state="correct"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-state="wrong"]')).toHaveLength(1);
    expect(screen.getAllByRole("radio")[0]).toBeDisabled();
    expect(screen.getByText("Correct answer")).toBeInTheDocument();
  });
});

describe("select all", () => {
  const q = serve("select_all", "beta blockade") as ServedSelectAll;

  test("says 'select all that apply' without revealing how many, and builds { optionIds }", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Stateful spy={spy}>
        {(v, set) => <SelectAll question={q} value={v as never} onChange={set as never} />}
      </Stateful>,
    );
    expect(screen.getByText("Select all that apply.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/choose \d|select \d|\b3 correct/i);
    await user.click(screen.getByRole("checkbox", { name: "Lower heart rate" }));
    await user.click(screen.getByRole("checkbox", { name: "Faster AV conduction" }));
    const last = spy.mock.calls.at(-1)?.[0] as { optionIds: string[] };
    expect(last.optionIds).toHaveLength(2);
    await user.click(screen.getByRole("checkbox", { name: "Faster AV conduction" }));
    const left = spy.mock.calls.at(-1)?.[0] as { optionIds: string[] };
    expect(left.optionIds).toHaveLength(1);
    await user.click(screen.getByRole("checkbox", { name: "Lower heart rate" }));
    expect(spy).toHaveBeenLastCalledWith(null);
  });

  test("grading shows correct picks, wrong picks and missed answers", () => {
    const stored = find("select_all", "beta blockade");
    if (stored.type !== "select_all") throw new Error();
    const pick = (text: string) => stored.options.find((o) => o.text === text)?.id as string;
    const answer = {
      type: "select_all" as const,
      optionIds: [pick("Lower heart rate"), pick("Faster AV conduction")],
    };
    const result = graded("select_all", "beta blockade", answer);
    const { container } = render(
      <SelectAll question={q} value={answer} onChange={() => undefined} disabled result={result} />,
    );
    expect(container.querySelectorAll('[data-state="correct"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-state="wrong"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-state="missed"]')).toHaveLength(2);
  });
});

describe("matching", () => {
  const q = serve("matching", "Veloxa") as ServedMatching;

  test("renders the items and the choices including distractors, without the pairing", () => {
    render(<Matching question={q} value={null} onChange={() => undefined} />);
    expect(screen.getAllByRole("listitem").length).toBe(q.lefts.length + q.rights.length);
    expect(q.rights).toContain("mirexapril");
    expect(q.rights.length).toBe(q.lefts.length + 2);
  });

  test("tap an item, then its match; a link is shown and can be undone", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Stateful spy={spy}>
        {(v, set) => <Matching question={q} value={v as never} onChange={set as never} />}
      </Stateful>,
    );
    await user.click(screen.getByRole("button", { name: /Cardimar/ }));
    await user.click(screen.getByRole("button", { name: /^tenzolol/ }));
    const cardimar = q.lefts.find((l) => l.text === "Cardimar")?.id;
    expect(spy).toHaveBeenLastCalledWith({
      type: "matching",
      matches: [{ pairId: cardimar, right: "tenzolol" }],
    });
    expect(screen.getByText("→ tenzolol")).toBeInTheDocument();
    // the cursor moves on to the next unmatched item
    await user.click(screen.getByRole("button", { name: /^lorvanol/ }));
    expect(screen.getByText("→ lorvanol")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove match for Cardimar" }));
    expect(screen.queryByText("→ tenzolol")).toBeNull();
    const left = spy.mock.calls.at(-1)?.[0] as { matches: unknown[] };
    expect(left.matches).toHaveLength(1);
  });

  test("results mark each pair and show the right match for wrong ones", () => {
    const stored = find("matching", "Veloxa");
    if (stored.type !== "matching") throw new Error();
    const answer = buildAnswer(stored, 1, "wrong");
    const result = graded("matching", "Veloxa", answer);
    const { container } = render(
      <Matching
        question={q}
        value={answer as never}
        onChange={() => undefined}
        disabled
        result={result}
      />,
    );
    expect(container.querySelectorAll('li[data-feedback="incorrect"]').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Correct: /).length).toBeGreaterThan(0);
  });
});

describe("fill in the blank", () => {
  const q = serve("fill_blank", "heart rate") as ServedFillBlank;

  test("inline inputs sized to the answer, no autocorrect, Enter moves on", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const submit = vi.fn();
    render(
      <Stateful spy={spy}>
        {(v, set) => (
          <FillBlank
            question={q}
            value={v as never}
            onChange={set as never}
            onSubmitRequest={submit}
          />
        )}
      </Stateful>,
    );
    const first = screen.getByLabelText("Blank 1 of 2");
    expect(first).toHaveAttribute("autocapitalize", "off");
    expect(first).toHaveAttribute("autocorrect", "off");
    expect(first).toHaveAttribute("spellcheck", "false");
    const second = screen.getByLabelText("Blank 2 of 2");
    // "heart rate" is longer than "beta": its field is wider
    expect(Number(second.style.width.replace("ch", ""))).toBeGreaterThan(
      Number(first.style.width.replace("ch", "")),
    );
    await user.type(first, "beta{Enter}");
    expect(second).toHaveFocus();
    await user.type(second, "pulse{Enter}");
    expect(spy).toHaveBeenLastCalledWith({ type: "fill_blank", blanks: ["beta", "pulse"] });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  test("results mark each blank and show the accepted answer for wrong ones", () => {
    const answer = { type: "fill_blank" as const, blanks: ["beta", "wrong"] };
    const result = graded("fill_blank", "heart rate", answer);
    const { container } = render(
      <FillBlank question={q} value={answer} onChange={() => undefined} disabled result={result} />,
    );
    expect(container.querySelectorAll('input[data-feedback="correct"]')).toHaveLength(1);
    expect(container.querySelectorAll('input[data-feedback="incorrect"]')).toHaveLength(1);
    expect(screen.getByText("(heart rate)")).toBeInTheDocument();
  });
});

describe("calculation", () => {
  const q = serve("calculation", "Mirexapril liquid") as ServedCalculation;

  test("shows the variant's numbers, the rounding note, a numeric keypad field and a unit field", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Stateful spy={spy}>
        {(v, set) => <Calculation question={q} value={v as never} onChange={set as never} />}
      </Stateful>,
    );
    expect(q.prompt).toMatch(/child of \d+ kg/);
    expect(screen.getByTestId("rounding-note")).toHaveTextContent("Round to 1 decimal place.");
    const value = screen.getByLabelText("Your answer");
    expect(value).toHaveAttribute("inputmode", "decimal");
    await user.type(value, "1.8");
    expect(spy).toHaveBeenLastCalledWith({ type: "calculation", response: "1.8" });
    await user.click(screen.getByRole("button", { name: "mL" }));
    expect(spy).toHaveBeenLastCalledWith({ type: "calculation", response: "1.8", unit: "mL" });
    // typing a unit works as well as picking one
    await user.clear(screen.getByLabelText("Unit"));
    await user.type(screen.getByLabelText("Unit"), "millilitre");
    expect(spy).toHaveBeenLastCalledWith({
      type: "calculation",
      response: "1.8",
      unit: "millilitre",
    });
  });

  test("a scratchpad is offered and is not part of the answer", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Calculation question={q} value={null} onChange={spy} />);
    await user.click(screen.getByRole("button", { name: /Scratchpad/ }));
    await user.type(screen.getByLabelText("Scratchpad"), "12 x 0.1");
    expect(spy).not.toHaveBeenCalled();
  });

  test("a number with no unit is allowed through so the result can say 'No unit given'", () => {
    const result = graded("calculation", "Convert 2.5 g", {
      type: "calculation",
      response: "2500",
    });
    const cq = serve("calculation", "Convert 2.5 g") as ServedCalculation;
    render(
      <Calculation
        question={cq}
        value={{ type: "calculation", response: "2500" }}
        onChange={() => undefined}
        disabled
        result={result}
      />,
    );
    expect(screen.getByTestId("calc-feedback")).toHaveTextContent(/No unit given/);
  });

  test("a 1000-fold slip is called out", () => {
    const cq = serve("calculation", "Convert 2.5 g") as ServedCalculation;
    const answer = { type: "calculation" as const, response: "2500", unit: "g" };
    render(
      <Calculation
        question={cq}
        value={answer}
        onChange={() => undefined}
        disabled
        result={graded("calculation", "Convert 2.5 g", answer)}
      />,
    );
    expect(screen.getByTestId("calc-feedback")).toHaveTextContent(/1000 times too large/);
  });
});

describe("flashcard", () => {
  const q = serve("flashcard", "Brand name of lorvanol") as ServedFlashcard;
  const reveal = vi.fn().mockResolvedValue({
    type: "flashcard",
    back: "Veloxa",
    explanation: "",
    intervals: { again: 1, hard: 3, good: 6, easy: 14 },
  });

  test("shows only the front until asked, then the back and the next interval on each button", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <Flashcard
        question={q}
        value={null}
        onChange={() => undefined}
        reveal={reveal}
        onCommit={commit}
      />,
    );
    expect(screen.getByTestId("card-front")).toHaveTextContent("Brand name of lorvanol");
    expect(screen.queryByTestId("rate-good")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    expect(await screen.findByTestId("rate-good")).toBeInTheDocument();
    expect(screen.getByTestId("card-back")).toHaveTextContent("Veloxa");
    expect(within(screen.getByTestId("rate-again")).getByText("1 day")).toBeInTheDocument();
    expect(within(screen.getByTestId("rate-hard")).getByText("3 days")).toBeInTheDocument();
    expect(within(screen.getByTestId("rate-good")).getByText("6 days")).toBeInTheDocument();
    expect(within(screen.getByTestId("rate-easy")).getByText("14 days")).toBeInTheDocument();
    await user.click(screen.getByTestId("rate-good"));
    expect(commit).toHaveBeenCalledWith({ type: "flashcard", rating: "good" });
  });

  test("keys 1 to 4 rate once the card is turned", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <Flashcard
        question={q}
        value={null}
        onChange={() => undefined}
        reveal={reveal}
        onCommit={commit}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    await screen.findByTestId("rate-easy");
    await user.keyboard("4");
    expect(commit).toHaveBeenCalledWith({ type: "flashcard", rating: "easy" });
  });

  test("the flip is a CSS transition, and the app-wide reduced-motion rule switches it off", () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
    expect(read("src/features/practice/practice.css")).toMatch(
      /\.pr-flip-inner \{[^}]*transition: transform var\(--duration-slow\)/,
    );
    expect(read("src/app/styles.css")).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*transition-duration: 0\.01ms/,
    );
  });
});

describe("free response", () => {
  const q = serve("free_response", "heart failure") as ServedFreeResponse;
  const reveal = vi.fn().mockResolvedValue({
    type: "free_response",
    modelAnswer: "It lowers heart rate.",
    rubric: [
      { point: "Lowers heart rate", points: 1 },
      { point: "Lowers oxygen demand", points: 1 },
      { point: "Reduces remodelling", points: 2 },
    ],
  });

  test("a text area first; model answer and a tick list after; submits ticks", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <FreeResponse
        question={q}
        value={null}
        onChange={() => undefined}
        reveal={reveal}
        onCommit={commit}
      />,
    );
    expect(screen.queryByTestId("model-answer")).toBeNull();
    await user.type(screen.getByLabelText("Your answer"), "It slows the heart");
    await user.click(screen.getByRole("button", { name: "Show model answer" }));
    expect(await screen.findByTestId("model-answer")).toHaveTextContent("It lowers heart rate.");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    await user.click(screen.getByRole("checkbox", { name: /Lowers heart rate/ }));
    await user.click(screen.getByRole("checkbox", { name: /Reduces remodelling/ }));
    expect(screen.getByText("3 of 4 points")).toBeInTheDocument();
    await user.click(screen.getByTestId("submit-self"));
    expect(commit).toHaveBeenCalledWith({
      type: "free_response",
      text: "It slows the heart",
      covered: [0, 2],
    });
  });
});

describe("case", () => {
  const q = serve("case", "64-year-old") as ServedCase;
  const stored = find("case", "64-year-old");

  test("keeps the vignette visible and walks the sub-questions in order", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(
      <Stateful<CaseDraft> spy={spy}>
        {(v, set) => <Case question={q} value={v} onChange={set as never} />}
      </Stateful>,
    );
    expect(screen.getByTestId("vignette")).toHaveTextContent("64-year-old man with heart failure");
    expect(screen.getByTestId("case-step")).toHaveTextContent("Part 1 of 3");
    expect(screen.getByTestId("next-part")).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Pulse of 58 per minute" }));
    await user.click(screen.getByTestId("next-part"));
    expect(screen.getByTestId("case-step")).toHaveTextContent("Part 2 of 3");
    // the vignette is still there
    expect(screen.getByTestId("vignette")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Blank 1 of 1"), "non");
    await user.click(screen.getByTestId("next-part"));
    expect(screen.getByTestId("case-step")).toHaveTextContent("Part 3 of 3");
    await user.click(screen.getByRole("button", { name: "Skip this part" }));
    const draft = spy.mock.calls.at(-1)?.[0] as CaseDraft;
    expect(draft.parts[0]?.type).toBe("multiple_choice");
    expect(draft.parts[1]).toEqual({ type: "fill_blank", blanks: ["non"] });
    expect(draft.parts[2]).toBeNull();
  });

  test("after grading every part is listed with its result and explanation", () => {
    if (stored.type !== "case") throw new Error();
    const answer = buildAnswer(stored, SEEDS.variantSeed, "wrong") as {
      type: "case";
      parts: never[];
    };
    const result = practice.grade(stored, answer, { variantSeed: SEEDS.variantSeed });
    const { container } = render(
      <Case
        question={q}
        value={{ type: "case", parts: answer.parts }}
        onChange={() => undefined}
        disabled
        result={result}
        partExplanations={stored.questions.map((p) => p.explanation)}
      />,
    );
    expect(screen.getByTestId("case-review")).toBeInTheDocument();
    expect(screen.getAllByText(/^Part \d of 3$/)).toHaveLength(3);
    expect(screen.getAllByText("Not quite").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("A slow pulse and a low-normal pressure");
    expect(screen.getAllByText(/Not correct|You chose/).length).toBeGreaterThan(0);
  });
});
