import { Check, ChevronDown } from "lucide-react";
import { Collapsible } from "radix-ui";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { StatTile } from "../../../components/ui/stat";
import { FEEDBACK_HUE } from "../../../lib/roles";
import { AnswerFor, type CaseDraft, type Draft } from "../answers";
import { formatDuration } from "../lib/dates";
import { percent, shortPrompt, summarise } from "../lib/results";
import type {
  PracticeStore,
  ResultItem,
  SessionResults,
  SessionScope,
  SourceCitation,
} from "../types";
import { TYPE_LABELS } from "../types";
import { FeedbackPanel, VERDICT_HUE, VerdictIcon, verdict } from "../ui/Feedback";
import { QUIET } from "../ui/quiet";

function encouragement(accuracy: number | null, answered: number): string {
  if (answered === 0 || accuracy === null) return "Nothing answered this time. That is fine.";
  if (accuracy >= 0.8) return "Solid work. What you know is holding.";
  if (accuracy >= 0.5) return "A good base. The misses below are where the next gains are.";
  return "A tough set. The ones you missed are saved, so they get another chance.";
}

function draftFor(item: ResultItem): Draft | null {
  if (!item.answer) return null;
  return item.answer.type === "case"
    ? ({ type: "case", parts: item.answer.parts } satisfies CaseDraft)
    : item.answer;
}

export function Results({
  store,
  results,
  onRetryMissed,
  onPracticeScope,
  onDone,
  onOpenNotebook,
  onOpenSource,
}: {
  store: PracticeStore;
  results: SessionResults;
  onRetryMissed: () => void;
  onPracticeScope: (scope: SessionScope) => void;
  onDone: () => void;
  onOpenNotebook: () => void;
  onOpenSource?: (c: SourceCitation) => void;
}) {
  const s = summarise(results.items);
  return (
    <div className="anim-fade space-y-6" data-testid="results">
      <Card padding="lg" className="md:p-8">
        <p className="text-ui font-medium text-text-muted">{results.scopeLabel}</p>
        <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
          <h1 className="font-display text-4xl font-semibold tracking-tight" data-testid="score">
            {s.correct} <span className="text-text-muted">of</span> {s.answered}
          </h1>
          <p className="pb-1 text-title text-text-muted">{percent(s.accuracy)} right</p>
        </div>
        <p className="mt-3 text-body">{encouragement(s.accuracy, s.answered)}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Time" value={formatDuration(s.timeMs)} />
          <StatTile label="Answered" value={`${s.answered} of ${s.total}`} />
          <StatTile label="Skipped" value={String(s.skipped)} />
          <StatTile label="Points" value={`${Math.round(s.points * 10) / 10} of ${s.maxPoints}`} />
        </div>
        {s.byType.length > 1 && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="By question type">
            {s.byType.map((t) => (
              <li key={t.type}>
                <Badge tone="neutral">
                  {TYPE_LABELS[t.type]} {t.correct}/{t.total}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="lg" className="space-y-4" as="section" aria-labelledby="next-steps">
        <h2 id="next-steps" className="text-title font-semibold">
          What next
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {s.missed.length > 0 && (
            <Button variant="primary" data-testid="retry-missed" onClick={onRetryMissed}>
              Retry the {s.missed.length} I missed
            </Button>
          )}
          {results.weakest?.scope && (
            <Button
              variant="secondary"
              data-testid="practise-weak"
              onClick={() => onPracticeScope(results.weakest?.scope as SessionScope)}
            >
              Practise {results.weakest.label}
            </Button>
          )}
          <Button variant="ghost" data-testid="done" onClick={onDone}>
            Back to practice
          </Button>
        </div>
        {results.weakest && (
          <p className="text-ui text-text-muted">
            {results.weakest.label} is at {percent(results.weakest.accuracy)} across your attempts
            so far.
          </p>
        )}
      </Card>

      {(s.notebookAdded.length > 0 || s.notebookCleared.length > 0) && (
        <Card padding="lg" className="space-y-3" as="section" aria-labelledby="nb-heading">
          <h2 id="nb-heading" className="text-title font-semibold">
            Missed-questions notebook
          </h2>
          {s.notebookAdded.length > 0 && (
            <>
              <p className="text-ui text-text-muted" data-testid="notebook-added-count">
                {s.notebookAdded.length}{" "}
                {s.notebookAdded.length === 1 ? "question was" : "questions were"} added or kept.
                Answer them correctly later and they leave.
              </p>
              <ul className="space-y-1.5 text-body">
                {s.notebookAdded.map((i) => (
                  <li key={i.index} className="flex gap-2">
                    <span aria-hidden>•</span>
                    <span>{shortPrompt(i.question, 100)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {s.notebookCleared.length > 0 && (
            <p
              data-hue={FEEDBACK_HUE.correct}
              className="flex items-center gap-1.5 text-ui font-medium text-tone-text"
            >
              <Check size={16} aria-hidden />
              {s.notebookCleared.length} left the notebook this time.
            </p>
          )}
          <Button variant="ghost" size="sm" className={QUIET} onClick={onOpenNotebook}>
            Open the notebook
          </Button>
        </Card>
      )}

      <section aria-labelledby="review-heading" className="space-y-3">
        <h2 id="review-heading" className="text-title font-semibold">
          Review each question
        </h2>
        <ul className="space-y-2.5">
          {results.items.map((item) => (
            <ReviewRow
              key={item.index}
              item={item}
              sessionId={results.sessionId}
              store={store}
              onOpenSource={onOpenSource}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ReviewRow({
  item,
  sessionId,
  store,
  onOpenSource,
}: {
  item: ResultItem;
  sessionId: string;
  store: PracticeStore;
  onOpenSource: ((c: SourceCitation) => void) | undefined;
}) {
  const v = item.outcome ? verdict(item.outcome.result) : null;
  return (
    <li>
      <Card padding="none" className="overflow-hidden">
        <Collapsible.Root data-testid={`review-${item.index}`}>
          <Collapsible.Trigger className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left">
            <span
              aria-hidden
              data-hue={v ? VERDICT_HUE[v.tone] : FEEDBACK_HUE.skipped}
              data-feedback={v ? undefined : "skipped"}
              className="grid size-8 shrink-0 place-items-center rounded-pill border border-tone-border bg-tone-soft text-tone-text"
            >
              <VerdictIcon tone={v ? v.tone : "skipped"} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium">
                {shortPrompt(item.question, 90)}
              </span>
              <span className="block text-caption text-text-muted">
                {TYPE_LABELS[item.question.type]} · {v ? v.title : "Skipped"}
                {item.timeTakenMs > 0 && ` · ${formatDuration(item.timeTakenMs)}`}
              </span>
            </span>
            <ChevronDown
              size={18}
              aria-hidden
              className="shrink-0 text-text-muted transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180"
            />
            <span className="sr-only">Show review</span>
          </Collapsible.Trigger>
          <Collapsible.Content className="border-t border-border px-4 py-5">
            {item.outcome ? (
              <div className="space-y-6">
                <AnswerFor
                  question={item.question}
                  draft={draftFor(item)}
                  onChange={() => undefined}
                  disabled
                  result={item.outcome.result}
                  partExplanations={item.outcome.partExplanations}
                  reveal={(p) => store.reveal(sessionId, item.index, p)}
                  onCommit={() => undefined}
                  onSubmitRequest={() => undefined}
                />
                <FeedbackPanel
                  outcome={item.outcome}
                  type={item.question.type}
                  onOpenSource={onOpenSource}
                />
              </div>
            ) : (
              <p className="text-ui text-text-muted">You skipped this one.</p>
            )}
          </Collapsible.Content>
        </Collapsible.Root>
      </Card>
    </li>
  );
}
