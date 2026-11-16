import type { practice } from "@notes/schema";
import type { GradeResult, Reveal, ServedPart } from "../types";
import { Calculation } from "./Calculation";
import { MultipleChoice, SelectAll } from "./Choices";
import { FillBlank } from "./FillBlank";
import { Matching } from "./Matching";
import { Flashcard, FreeResponse } from "./SelfGraded";

export type PartDraft = practice.PartAnswer;

export interface PartViewProps {
  question: ServedPart;
  value: PartDraft | null;
  onChange: (answer: PartDraft | null) => void;
  disabled?: boolean;
  result?: GradeResult | null;
  reveal?: () => Promise<Reveal>;
  onCommit?: (answer: PartDraft) => void;
  onSubmitRequest?: () => void;
  mode?: "single" | "part";
}

/** The answering UI for one non-case question (or one sub-question of a case). */
export function PartView({ question, value, ...rest }: PartViewProps) {
  // The value's `type` always matches the question's, so the casts only pick the matching shape.
  const props = { ...rest, value: value as never };
  switch (question.type) {
    case "multiple_choice":
      return <MultipleChoice question={question} {...props} />;
    case "select_all":
      return <SelectAll question={question} {...props} />;
    case "matching":
      return <Matching question={question} {...props} />;
    case "fill_blank":
      return <FillBlank question={question} {...props} />;
    case "calculation":
      return <Calculation question={question} {...props} />;
    case "flashcard":
      return <Flashcard question={question} {...props} />;
    case "free_response":
      return <FreeResponse question={question} {...props} />;
  }
}

/** Can this draft be submitted? */
export function isPartReady(question: ServedPart, value: PartDraft | null): boolean {
  if (!value || value.type !== question.type) return false;
  switch (value.type) {
    case "multiple_choice":
      return Boolean(value.optionId);
    case "select_all":
      return value.optionIds.length > 0;
    case "matching":
      return (
        question.type === "matching" &&
        question.lefts.every((l) => value.matches.some((m) => m.pairId === l.id))
      );
    case "fill_blank":
      return value.blanks.some((b) => b.trim() !== "");
    case "calculation":
      return value.response.trim() !== "";
    case "flashcard":
      return true;
    case "free_response":
      return true;
  }
}
