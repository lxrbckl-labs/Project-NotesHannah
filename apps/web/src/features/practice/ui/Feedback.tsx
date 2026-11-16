import { forwardRef } from "react";
import type { GradeResult, QuestionOutcome, SourceCitation } from "../types";
import { Markdown } from "./Markdown";
import { Chip } from "./primitives";

export function SourceChips({
  citations,
  generalKnowledge,
  onOpenSource,
}: {
  citations: SourceCitation[];
  generalKnowledge: boolean;
  onOpenSource?: ((citation: SourceCitation) => void) | undefined;
}) {
  if (generalKnowledge) return <Chip>Not from your notes</Chip>;
  if (citations.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Sources">
      {citations.map((c) => {
        const label = c.label ? `from ${c.label}` : "from your notes";
        return (
          <li key={`${c.fileId}-${c.pageId}-${c.quote.slice(0, 12)}`}>
            <button
              type="button"
              onClick={() => onOpenSource?.(c)}
              aria-label={`Open source: ${c.label ?? "your notes"}`}
              data-testid="source-chip"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-sm text-accent transition-colors hover:bg-surface-muted"
            >
              <span aria-hidden>❝</span>
              {label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The lines of a grade worth reading: what went wrong, or the one remark when right. */
export function visibleFeedback(result: GradeResult) {
  if (result.feedback.length <= 1) return result.feedback.filter((f) => f.message);
  return result.feedback.filter((f) => !f.correct);
}

export function FeedbackLines({ result }: { result: GradeResult }) {
  const lines = visibleFeedback(result);
  if (lines.length === 0) return null;
  const multi = result.feedback.length > 1;
  return (
    <ul className="space-y-1.5 text-[0.95rem]">
      {lines.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: feedback lines are positional
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-0.5 w-4 shrink-0 text-center">
            {f.correct ? "✓" : "✗"}
          </span>
          <span>
            {multi && <span className="font-medium">{f.label}: </span>}
            {f.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function verdict(result: GradeResult): { tone: "ok" | "bad" | "part"; title: string } {
  if (result.correct) return { tone: "ok", title: "Correct" };
  if (result.maxPoints > 1 && result.points > 0)
    return {
      tone: "part",
      title: `Partly right: ${fmt(result.points)} of ${fmt(result.maxPoints)}`,
    };
  return { tone: "bad", title: "Not quite" };
}
const fmt = (n: number) => String(Math.round(n * 100) / 100);

export const FeedbackPanel = forwardRef<
  HTMLElement,
  {
    outcome: QuestionOutcome;
    type: string;
    onOpenSource?: ((citation: SourceCitation) => void) | undefined;
  }
>(function FeedbackPanel({ outcome, type, onOpenSource }, ref) {
  const { result } = outcome;
  const v = verdict(result);
  const isCase = type === "case";
  const selfGraded = type === "flashcard" || type === "free_response";
  // Choices, matching and blanks show the right answer in place; a calculation needs it spelled out.
  const showCorrect = !result.correct && type === "calculation" && result.correctAnswer.text;
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label="Feedback"
      data-testid="feedback"
      data-correct={result.correct}
      className="pr-rise space-y-4 outline-none"
    >
      <div
        className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${`pr-${v.tone === "ok" ? "ok" : v.tone === "bad" ? "bad" : "part"}`}`}
      >
        <span aria-hidden className="text-xl">
          {v.tone === "ok" ? "✓" : v.tone === "bad" ? "✗" : "◐"}
        </span>
        <h2 className="text-base font-semibold" data-testid="verdict">
          {selfGraded && result.correct ? "Marked as recalled" : v.title}
        </h2>
      </div>
      {!isCase && !selfGraded && type !== "calculation" && <FeedbackLines result={result} />}
      {isCase && (
        <p className="text-sm text-text-muted">
          {fmt(result.points)} of {fmt(result.maxPoints)} points across the parts.
        </p>
      )}
      {showCorrect && (
        <p className="text-[0.95rem]" data-testid="correct-answer">
          <span className="font-medium">Correct answer: </span>
          {result.correctAnswer.text}
        </p>
      )}
      {outcome.explanation && (
        <div className="rounded-2xl bg-surface-muted p-4 text-[0.95rem] leading-relaxed">
          <h3 className="mb-1 text-sm font-semibold text-text-muted">Why</h3>
          <Markdown text={outcome.explanation} />
        </div>
      )}
      <SourceChips
        citations={outcome.citations}
        generalKnowledge={outcome.generalKnowledge}
        onOpenSource={onOpenSource}
      />
      {outcome.notebookNote && (
        <p className="text-sm text-text-muted" data-testid="notebook-note">
          {outcome.notebookNote}
        </p>
      )}
    </section>
  );
});

/** What a person hears when the result arrives. */
export function announcement(outcome: QuestionOutcome, type: string): string {
  const { result } = outcome;
  const head = verdict(result).title;
  if (type === "case" || type === "flashcard" || type === "free_response") return head;
  return result.correct ? head : `${head}. Correct answer: ${result.correctAnswer.text}`;
}
