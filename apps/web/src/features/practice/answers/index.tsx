import type { Answer, GradeResult, Reveal, ServedQuestion } from "../types";
import { Case, type CaseDraft, isCaseReady } from "./Case";
import { isPartReady, type PartDraft, PartView } from "./Part";

export type Draft = Answer | CaseDraft;

export { Calculation, roundingNote } from "./Calculation";
export { Case, type CaseDraft } from "./Case";
export { MultipleChoice, SelectAll } from "./Choices";
export { FillBlank } from "./FillBlank";
export { Matching } from "./Matching";
export { type PartDraft, PartView } from "./Part";
export { Flashcard, FreeResponse, formatInterval } from "./SelfGraded";

/** Self-graded types submit from inside their own component; the footer button is not used. */
export const SELF_SUBMITTING = new Set(["flashcard", "free_response"]);

export function isReady(question: ServedQuestion, draft: Draft | null): boolean {
  if (question.type === "case") return isCaseReady(question, draft as CaseDraft | null);
  return isPartReady(question, draft as PartDraft | null);
}

/** Case drafts become the schema's answer: unvisited and skipped parts are null. */
export function toAnswer(question: ServedQuestion, draft: Draft): Answer {
  if (question.type === "case") {
    const d = draft as CaseDraft;
    return {
      type: "case",
      parts: question.parts.map((_, i) => (d.parts[i] ?? null) as PartDraft | null),
    };
  }
  return draft as Answer;
}

export function AnswerFor({
  question,
  draft,
  onChange,
  disabled,
  result,
  partExplanations,
  reveal,
  onCommit,
  onSubmitRequest,
}: {
  question: ServedQuestion;
  draft: Draft | null;
  onChange: (draft: Draft | null) => void;
  disabled: boolean;
  result: GradeResult | null;
  partExplanations?: string[] | undefined;
  reveal: (partIndex?: number) => Promise<Reveal>;
  onCommit: (answer: Answer) => void;
  onSubmitRequest: () => void;
}) {
  if (question.type === "case") {
    return (
      <Case
        question={question}
        value={draft as CaseDraft | null}
        onChange={onChange}
        disabled={disabled}
        result={result}
        partExplanations={partExplanations}
        reveal={(i) => reveal(i)}
        onSubmitRequest={onSubmitRequest}
      />
    );
  }
  return (
    <PartView
      key={question.questionId + question.index}
      question={question}
      value={draft as PartDraft | null}
      onChange={onChange as (a: PartDraft | null) => void}
      disabled={disabled}
      result={result}
      reveal={() => reveal()}
      onCommit={onCommit as (a: PartDraft) => void}
      onSubmitRequest={onSubmitRequest}
    />
  );
}
