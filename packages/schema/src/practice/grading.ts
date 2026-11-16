/**
 * Grading. Pure functions; the app contains no AI, so every objective type is
 * graded by the rules here and the self-graded types take her own judgement.
 *
 * `grade` never throws. An answer that cannot be read (wrong shape, unknown
 * option id, wrong number of blanks) comes back as an incorrect result with
 * `malformed: true` and the reason in the feedback.
 */
import { ANSWER_SCHEMAS, type Answer, type PartAnswer } from "./answers.js";
import { instantiateCalculation, judgeCalculation } from "./calculation.js";
import type { Question, QuestionPart, QuestionType } from "./content.js";
import type { GradeFeedback, GradeResult } from "./grade-result.js";
import { deriveSeed } from "./rng.js";
import { matchBlank, normaliseLoose } from "./text-match.js";

export interface GradeContext {
  /**
   * The seed the question was shown with. Needed for calculation questions
   * with variables (the numbers come from the seed). Defaults to 0.
   */
  variantSeed?: number | null | undefined;
}

type Gradable = Question | QuestionPart;
type Of<T extends QuestionType> = Extract<Gradable, { type: T }>;

/** How a self-rating counts. */
export const RATING_SCORE = { again: 0, hard: 0.5, good: 1, easy: 1 } as const;

const NO_ANSWER = { text: "", data: null } as const;

function result(
  partial: Partial<GradeResult> & Pick<GradeResult, "correct" | "correctAnswer">,
): GradeResult {
  const maxPoints = partial.maxPoints ?? 1;
  const score = partial.score ?? (partial.correct ? 1 : 0);
  return {
    score,
    points: partial.points ?? score * maxPoints,
    maxPoints,
    selfGraded: false,
    malformed: false,
    feedback: [],
    ...partial,
  };
}

function fb(label: string, correct: boolean, code: string, message: string): GradeFeedback {
  return { label, correct, code, message };
}

function malformed(
  reason: string,
  correctAnswer: GradeResult["correctAnswer"],
  maxPoints = 1,
): GradeResult {
  return result({
    correct: false,
    score: 0,
    maxPoints,
    malformed: true,
    correctAnswer,
    feedback: [fb("Answer", false, "malformed", reason)],
  });
}

/** Short text for a zod error. */
function whyUnreadable(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return "The answer could not be read.";
  const where = issue.path.length ? ` (at ${issue.path.map(String).join(".")})` : "";
  return `The answer could not be read${where}: ${issue.message}`;
}

// ---------------------------------------------------------- per-type grading

function gradeMultipleChoice(
  q: Of<"multiple_choice">,
  a: Extract<Answer, { type: "multiple_choice" }>,
): GradeResult {
  const right = q.options.find((o) => o.correct) ?? (q.options[0] as (typeof q.options)[number]);
  const correctAnswer = { text: right.text, data: { type: "multiple_choice", optionId: right.id } };
  const chosen = q.options.find((o) => o.id === a.optionId);
  if (!chosen) return malformed(`There is no option with id "${a.optionId}".`, correctAnswer);
  const ok = chosen.id === right.id;
  const messages: string[] = [];
  if (!ok) messages.push("Not correct.");
  if (chosen.rationale) messages.push(chosen.rationale);
  if (!ok) {
    messages.push(
      `The correct answer is "${right.text}".${right.rationale ? ` ${right.rationale}` : ""}`,
    );
  }
  return result({
    correct: ok,
    correctAnswer,
    feedback: [fb(chosen.text, ok, ok ? "correct" : "incorrect", messages.join(" ") || "Correct.")],
  });
}

function gradeSelectAll(
  q: Of<"select_all">,
  a: Extract<Answer, { type: "select_all" }>,
): GradeResult {
  const rightIds = q.options.filter((o) => o.correct).map((o) => o.id);
  const correctAnswer = {
    text: q.options
      .filter((o) => o.correct)
      .map((o) => o.text)
      .join("; "),
    data: { type: "select_all", optionIds: rightIds },
  };
  const known = new Set(q.options.map((o) => o.id));
  const unknown = a.optionIds.find((id) => !known.has(id));
  if (unknown !== undefined)
    return malformed(`There is no option with id "${unknown}".`, correctAnswer);
  const picked = new Set(a.optionIds);
  let hits = 0;
  let wrongPicks = 0;
  const feedback: GradeFeedback[] = [];
  for (const o of q.options) {
    const isPicked = picked.has(o.id);
    if (o.correct && isPicked) hits++;
    if (!o.correct && isPicked) wrongPicks++;
    const ok = o.correct === isPicked;
    const code = ok
      ? o.correct
        ? "correct_pick"
        : "correct_skip"
      : o.correct
        ? "missed"
        : "wrongly_selected";
    const base = ok
      ? ""
      : o.correct
        ? "This one is correct and was not selected. "
        : "This one is not correct but was selected. ";
    feedback.push(
      fb(o.text, ok, code, `${base}${o.rationale ?? ""}`.trim() || (ok ? "Right." : "Wrong.")),
    );
  }
  const partialScore = Math.max(0, (hits - wrongPicks) / rightIds.length);
  const ok = hits === rightIds.length && wrongPicks === 0;
  return result({ correct: ok, score: ok ? 1 : 0, partialScore, correctAnswer, feedback });
}

function gradeMatching(q: Of<"matching">, a: Extract<Answer, { type: "matching" }>): GradeResult {
  const correctAnswer = {
    text: q.pairs.map((p) => `${p.left} → ${p.right}`).join("; "),
    data: { type: "matching", matches: q.pairs.map((p) => ({ pairId: p.id, right: p.right })) },
  };
  const known = new Set(q.pairs.map((p) => p.id));
  const given = new Map<string, string>();
  for (const m of a.matches) {
    if (!known.has(m.pairId))
      return malformed(`There is no pair with id "${m.pairId}".`, correctAnswer, q.pairs.length);
    if (given.has(m.pairId))
      return malformed(`Pair "${m.pairId}" was answered twice.`, correctAnswer, q.pairs.length);
    given.set(m.pairId, m.right);
  }
  let hits = 0;
  const feedback: GradeFeedback[] = q.pairs.map((p) => {
    const g = given.get(p.id);
    if (g === undefined || normaliseLoose(g) === "") {
      return fb(p.left, false, "unanswered", `Not answered. Correct: ${p.right}.`);
    }
    if (normaliseLoose(g) === normaliseLoose(p.right)) {
      hits++;
      return fb(p.left, true, "correct", `${p.right}`);
    }
    return fb(p.left, false, "incorrect", `You chose "${g}". Correct: ${p.right}.`);
  });
  const ok = hits === q.pairs.length;
  return result({
    correct: ok,
    score: hits / q.pairs.length,
    points: hits,
    maxPoints: q.pairs.length,
    correctAnswer,
    feedback,
  });
}

function gradeFillBlank(
  q: Of<"fill_blank">,
  a: Extract<Answer, { type: "fill_blank" }>,
): GradeResult {
  const correctAnswer = {
    text: q.blanks.map((b, i) => `${i + 1}: ${b.answers[0]}`).join("; "),
    data: { type: "fill_blank", blanks: q.blanks.map((b) => b.answers[0]) },
  };
  if (a.blanks.length !== q.blanks.length) {
    return malformed(
      `Expected ${q.blanks.length} answer(s), got ${a.blanks.length}.`,
      correctAnswer,
      q.blanks.length,
    );
  }
  let hits = 0;
  const feedback: GradeFeedback[] = q.blanks.map((b, i) => {
    const label = `Blank ${i + 1}`;
    const given = a.blanks[i] as string;
    if (given.trim() === "")
      return fb(label, false, "empty", `Left blank. Accepted: ${b.answers.join(" / ")}.`);
    const m = matchBlank(given, b);
    if (m.match === "exact") {
      hits++;
      return fb(label, true, "correct", "Correct.");
    }
    if (m.match === "typo") {
      hits++;
      return fb(label, true, "typo_accepted", `Accepted, but check the spelling: ${m.answer}.`);
    }
    return fb(label, false, "incorrect", `Not correct. Accepted: ${b.answers.join(" / ")}.`);
  });
  const ok = hits === q.blanks.length;
  return result({
    correct: ok,
    score: hits / q.blanks.length,
    points: hits,
    maxPoints: q.blanks.length,
    correctAnswer,
    feedback,
  });
}

function gradeCalculation(
  q: Of<"calculation">,
  a: Extract<Answer, { type: "calculation" }>,
  seed: number,
): GradeResult {
  let instance: ReturnType<typeof instantiateCalculation>;
  try {
    instance = instantiateCalculation(q, seed);
  } catch (e) {
    return malformed(
      `This question's numbers could not be generated: ${(e as Error).message}`,
      NO_ANSWER,
    );
  }
  const correctAnswer = {
    text: instance.answerText,
    data: { type: "calculation", response: instance.answerText },
  };
  const verdict = judgeCalculation(q, a, instance);
  return result({
    correct: verdict.correct,
    correctAnswer,
    feedback: [fb("Answer", verdict.correct, verdict.code, verdict.message)],
  });
}

function gradeFlashcard(
  q: Of<"flashcard">,
  a: Extract<Answer, { type: "flashcard" }>,
): GradeResult {
  const score = RATING_SCORE[a.rating];
  return result({
    correct: a.rating !== "again",
    score,
    selfGraded: true,
    correctAnswer: { text: q.back, data: { type: "flashcard" } },
    feedback: [fb("Self-rating", a.rating !== "again", a.rating, `You rated this "${a.rating}".`)],
  });
}

function gradeFreeResponse(
  q: Of<"free_response">,
  a: Extract<Answer, { type: "free_response" }>,
): GradeResult {
  const max = q.rubric.reduce((s, r) => s + r.points, 0);
  const correctAnswer = {
    text: q.modelAnswer,
    data: { type: "free_response", text: q.modelAnswer },
  };
  const covered = new Set(a.covered);
  const bad = [...covered].find((i) => i >= q.rubric.length);
  if (bad !== undefined) {
    return malformed(
      `Key point ${bad + 1} does not exist; this answer has ${q.rubric.length}.`,
      correctAnswer,
      max,
    );
  }
  let points = 0;
  const feedback = q.rubric.map((r, i) => {
    const got = covered.has(i);
    if (got) points += r.points;
    return fb(
      r.point,
      got,
      got ? "covered" : "missed",
      got ? `Covered (${r.points} pt).` : `Not covered (${r.points} pt).`,
    );
  });
  const score = max === 0 ? 0 : points / max;
  return result({
    correct: score >= q.passFraction - 1e-9,
    score,
    points,
    maxPoints: max,
    selfGraded: true,
    correctAnswer,
    feedback,
  });
}

function gradeCase(q: Of<"case">, a: Extract<Answer, { type: "case" }>, seed: number): GradeResult {
  const partResults: GradeResult[] = q.questions.map((part, i) => {
    const partAnswer = a.parts[i] ?? null;
    const partSeed = deriveSeed(seed, "part", i);
    if (partAnswer === null) {
      return {
        correct: false,
        score: 0,
        points: 0,
        maxPoints: maxPointsOf(part),
        selfGraded: !isAppGraded(part),
        malformed: false,
        feedback: [fb("Answer", false, "unanswered", "Not answered.")],
        correctAnswer: correctAnswerOf(part, partSeed),
      };
    }
    return gradeAny(part, partAnswer, { variantSeed: partSeed });
  });
  const maxPoints = partResults.reduce((s, r) => s + r.maxPoints, 0);
  const points = partResults.reduce((s, r) => s + r.points, 0);
  const score = maxPoints === 0 ? 0 : points / maxPoints;
  const allOk = partResults.every((r) => r.correct);
  const extra = a.parts.length > q.questions.length;
  return result({
    correct: allOk && !extra,
    score,
    points,
    maxPoints,
    partialScore: score,
    selfGraded: partResults.some((r) => r.selfGraded),
    malformed: extra,
    correctAnswer: {
      text: partResults.map((r, i) => `${i + 1}. ${r.correctAnswer.text}`).join("\n"),
      data: { type: "case", parts: partResults.map((r) => r.correctAnswer.data) },
    },
    feedback: [
      ...(extra
        ? [
            fb(
              "Answer",
              false,
              "malformed",
              `Expected at most ${q.questions.length} sub-answers, got ${a.parts.length}.`,
            ),
          ]
        : []),
      ...partResults.map((r, i) =>
        fb(
          `Sub-question ${i + 1}`,
          r.correct,
          r.correct ? "correct" : "incorrect",
          r.feedback
            .map((f) => f.message)
            .filter(Boolean)
            .join(" ") || (r.correct ? "Correct." : "Not correct."),
        ),
      ),
    ],
    parts: partResults,
  });
}

// ----------------------------------------------------------------- dispatch

/** The most points a question can earn: one for single-answer types, one per pair or blank, the rubric total, or the sum over a case. */
export function maxPointsOf(q: Gradable): number {
  switch (q.type) {
    case "matching":
      return q.pairs.length;
    case "fill_blank":
      return q.blanks.length;
    case "free_response":
      return q.rubric.reduce((s, r) => s + r.points, 0);
    case "case":
      return q.questions.reduce((s, p) => s + maxPointsOf(p), 0);
    default:
      return 1;
  }
}

function gradeAny(q: Gradable, answer: unknown, ctx: GradeContext): GradeResult {
  const seed = ctx.variantSeed ?? 0;
  try {
    if (answer === null || answer === undefined) {
      return malformed("No answer was given.", correctAnswerOf(q, seed), maxPointsOf(q));
    }
    const schema = ANSWER_SCHEMAS[q.type];
    const parsed = schema.safeParse(answer);
    if (!parsed.success) {
      const given = (answer as { type?: unknown } | null)?.type;
      const reason =
        typeof given === "string" && given !== q.type
          ? `This is a ${q.type} question but the answer has type "${given}".`
          : whyUnreadable(parsed.error);
      return malformed(reason, correctAnswerOf(q, seed), maxPointsOf(q));
    }
    const a = parsed.data as Answer;
    switch (q.type) {
      case "multiple_choice":
        return gradeMultipleChoice(q, a as never);
      case "select_all":
        return gradeSelectAll(q, a as never);
      case "matching":
        return gradeMatching(q, a as never);
      case "fill_blank":
        return gradeFillBlank(q, a as never);
      case "calculation":
        return gradeCalculation(q, a as never, seed);
      case "flashcard":
        return gradeFlashcard(q, a as never);
      case "free_response":
        return gradeFreeResponse(q, a as never);
      case "case":
        return gradeCase(q, a as never, seed);
    }
  } catch (e) {
    return malformed(
      `The answer could not be graded: ${(e as Error).message}`,
      NO_ANSWER,
      maxPointsOf(q),
    );
  }
}

/** The correct answer for display, without needing an answer. Never throws. */
export function correctAnswerOf(q: Gradable, seed = 0): GradeResult["correctAnswer"] {
  try {
    switch (q.type) {
      case "multiple_choice": {
        const right = q.options.find((o) => o.correct);
        return { text: right?.text ?? "", data: { type: "multiple_choice", optionId: right?.id } };
      }
      case "select_all": {
        const right = q.options.filter((o) => o.correct);
        return {
          text: right.map((o) => o.text).join("; "),
          data: { type: "select_all", optionIds: right.map((o) => o.id) },
        };
      }
      case "matching":
        return {
          text: q.pairs.map((p) => `${p.left} → ${p.right}`).join("; "),
          data: {
            type: "matching",
            matches: q.pairs.map((p) => ({ pairId: p.id, right: p.right })),
          },
        };
      case "fill_blank":
        return {
          text: q.blanks.map((b, i) => `${i + 1}: ${b.answers[0]}`).join("; "),
          data: { type: "fill_blank", blanks: q.blanks.map((b) => b.answers[0]) },
        };
      case "calculation": {
        const inst = instantiateCalculation(q, seed);
        return { text: inst.answerText, data: { type: "calculation", response: inst.answerText } };
      }
      case "flashcard":
        return { text: q.back, data: { type: "flashcard" } };
      case "free_response":
        return { text: q.modelAnswer, data: { type: "free_response", text: q.modelAnswer } };
      case "case": {
        const parts = q.questions.map((p, i) => correctAnswerOf(p, deriveSeed(seed, "part", i)));
        return {
          text: parts.map((p, i) => `${i + 1}. ${p.text}`).join("\n"),
          data: { type: "case", parts: parts.map((p) => p.data) },
        };
      }
    }
  } catch {
    return NO_ANSWER;
  }
}

/**
 * Grade an answer. `answer` is anything a client sent; it is checked first.
 * For a case, each sub-question is graded and the results are combined:
 * points add up, `score` is points over maximum points, and `correct` needs
 * every sub-question correct.
 */
export function grade(question: Gradable, answer: unknown, ctx: GradeContext = {}): GradeResult {
  return gradeAny(question, answer, ctx);
}

/** Can the app grade this question without her help? (A case is app-graded only if all its parts are.) */
export function isAppGraded(question: Gradable): boolean {
  if (question.type === "flashcard" || question.type === "free_response") return false;
  if (question.type === "case") return question.questions.every((p) => isAppGraded(p));
  return true;
}

export type { PartAnswer };
