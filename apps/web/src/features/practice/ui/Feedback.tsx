import { Check, Contrast, Minus, Quote, X } from "lucide-react";
import { forwardRef } from "react";
import { Badge, Chip } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { FEEDBACK_HUE } from "../../../lib/roles";
import type { GradeResult, QuestionOutcome, SourceCitation } from "../types";
import { CorrectSpark } from "./CorrectSpark";
import { Markdown } from "./Markdown";

export type VerdictTone = "ok" | "bad" | "part";

/** The role of each verdict: correct, incorrect, partly right. */
export const VERDICT_HUE = {
  ok: FEEDBACK_HUE.correct,
  bad: FEEDBACK_HUE.incorrect,
  part: FEEDBACK_HUE.partial,
} as const;

/** What the result means as a data attribute, so a test or a style can tell without colour. */
export const VERDICT_NAME = { ok: "correct", bad: "incorrect", part: "partial" } as const;

/** The icon that goes with a verdict: colour is never the only signal. */
export function VerdictIcon({ tone, size = 18 }: { tone: VerdictTone | "skipped"; size?: number }) {
  if (tone === "ok") return <Check size={size} aria-hidden />;
  if (tone === "bad") return <X size={size} aria-hidden />;
  if (tone === "part") return <Contrast size={size} aria-hidden />;
  return <Minus size={size} aria-hidden />;
}

export function SourceChips({
  citations,
  generalKnowledge,
  onOpenSource,
}: {
  citations: SourceCitation[];
  generalKnowledge: boolean;
  onOpenSource?: ((citation: SourceCitation) => void) | undefined;
}) {
  if (generalKnowledge) return <Badge tone="neutral">Not from your notes</Badge>;
  if (citations.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Sources">
      {citations.map((c) => {
        const label = c.label ? `from ${c.label}` : "from your notes";
        return (
          <li key={`${c.fileId}-${c.pageId}-${c.quote.slice(0, 12)}`}>
            <Chip
              hue="accent"
              icon={<Quote />}
              onClick={() => onOpenSource?.(c)}
              aria-label={`Open source: ${c.label ?? "your notes"}`}
              data-testid="source-chip"
            >
              {label}
            </Chip>
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
    <ul className="space-y-1.5 text-body">
      {lines.map((f, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: feedback lines are positional
        <li key={i} className="flex gap-2">
          <span
            aria-hidden
            data-hue={f.correct ? FEEDBACK_HUE.correct : FEEDBACK_HUE.incorrect}
            className="mt-0.5 flex w-4 shrink-0 justify-center text-tone-text"
          >
            <VerdictIcon tone={f.correct ? "ok" : "bad"} size={16} />
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

export function verdict(result: GradeResult): { tone: VerdictTone; title: string } {
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
    /** Ask an agent about this question (the shell opens its request composer). */
    onAsk?: (() => void) | undefined;
    /** A small spark on a correct answer; only for a live answer, not a later review. */
    celebrate?: boolean;
  }
>(function FeedbackPanel({ outcome, type, onOpenSource, onAsk, celebrate = false }, ref) {
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
      className="anim-pop space-y-4 outline-none"
    >
      <div
        data-hue={VERDICT_HUE[v.tone]}
        data-feedback={VERDICT_NAME[v.tone]}
        className="flex items-center gap-3 rounded-card border border-tone-border bg-tone-soft px-4 py-3 text-tone-text"
      >
        <span className="relative flex size-6 shrink-0 items-center justify-center">
          <VerdictIcon tone={v.tone} size={22} />
          {v.tone === "ok" && celebrate && <CorrectSpark />}
        </span>
        <h2 className="text-body font-semibold" data-testid="verdict">
          {selfGraded && result.correct ? "Marked as recalled" : v.title}
        </h2>
      </div>
      {!isCase && !selfGraded && type !== "calculation" && <FeedbackLines result={result} />}
      {isCase && (
        <p className="text-ui text-text-muted">
          {fmt(result.points)} of {fmt(result.maxPoints)} points across the parts.
        </p>
      )}
      {showCorrect && (
        <p className="text-body" data-testid="correct-answer">
          <span className="font-medium">Correct answer: </span>
          {result.correctAnswer.text}
        </p>
      )}
      {outcome.explanation && (
        <div className="rounded-card bg-surface-muted p-4 text-body leading-relaxed">
          <h3 className="mb-1 text-ui font-semibold text-text-muted">Why</h3>
          <Markdown text={outcome.explanation} />
        </div>
      )}
      <SourceChips
        citations={outcome.citations}
        generalKnowledge={outcome.generalKnowledge}
        onOpenSource={onOpenSource}
      />
      {outcome.notebookNote && (
        <p className="text-ui text-text-muted" data-testid="notebook-note">
          {outcome.notebookNote}
        </p>
      )}
      {onAsk ? (
        <Button variant="ghostAccent" size="sm" data-testid="ask-about-question" onClick={onAsk}>
          Ask an agent about this question
        </Button>
      ) : null}
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
