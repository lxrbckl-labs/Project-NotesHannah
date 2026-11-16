import { Collapsible } from "radix-ui";
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
import { FeedbackPanel, verdict } from "../ui/Feedback";
import { Button, Card, Chip } from "../ui/primitives";

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
    <div className="space-y-6 pr-fade" data-testid="results">
      <Card className="p-6 md:p-8">
        <p className="text-sm font-medium text-text-muted">{results.scopeLabel}</p>
        <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
          <h1 className="text-4xl font-semibold tracking-tight" data-testid="score">
            {s.correct} <span className="text-text-muted">of</span> {s.answered}
          </h1>
          <p className="pb-1 text-lg text-text-muted">{percent(s.accuracy)} right</p>
        </div>
        <p className="mt-3 text-[1.02rem]">{encouragement(s.accuracy, s.answered)}</p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Time" value={formatDuration(s.timeMs)} />
          <Stat label="Answered" value={`${s.answered} of ${s.total}`} />
          <Stat label="Skipped" value={String(s.skipped)} />
          <Stat label="Points" value={`${Math.round(s.points * 10) / 10} of ${s.maxPoints}`} />
        </dl>
        {s.byType.length > 1 && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="By question type">
            {s.byType.map((t) => (
              <li key={t.type}>
                <Chip>
                  {TYPE_LABELS[t.type]} {t.correct}/{t.total}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4 p-6" as="section" aria-labelledby="next-steps">
        <h2 id="next-steps" className="text-base font-semibold">
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
          <p className="text-sm text-text-muted">
            {results.weakest.label} is at {percent(results.weakest.accuracy)} across your attempts
            so far.
          </p>
        )}
      </Card>

      {(s.notebookAdded.length > 0 || s.notebookCleared.length > 0) && (
        <Card className="space-y-3 p-6" as="section" aria-labelledby="nb-heading">
          <h2 id="nb-heading" className="text-base font-semibold">
            Missed-questions notebook
          </h2>
          {s.notebookAdded.length > 0 && (
            <>
              <p className="text-sm text-text-muted" data-testid="notebook-added-count">
                {s.notebookAdded.length}{" "}
                {s.notebookAdded.length === 1 ? "question was" : "questions were"} added or kept.
                Answer them correctly later and they leave.
              </p>
              <ul className="space-y-1.5 text-[0.95rem]">
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
            <p className="text-sm" style={{ color: "var(--pr-correct)" }}>
              {s.notebookCleared.length} left the notebook this time.
            </p>
          )}
          <Button variant="quiet" size="sm" onClick={onOpenNotebook}>
            Open the notebook
          </Button>
        </Card>
      )}

      <section aria-labelledby="review-heading" className="space-y-3">
        <h2 id="review-heading" className="text-base font-semibold">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-muted px-3.5 py-2.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
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
      <Collapsible.Root className="pr-card overflow-hidden" data-testid={`review-${item.index}`}>
        <Collapsible.Trigger className="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left">
          <span
            aria-hidden
            className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm ${
              v
                ? `pr-${v.tone === "ok" ? "ok" : v.tone === "bad" ? "bad" : "part"}`
                : "border-border text-text-muted"
            }`}
          >
            {v ? (v.tone === "ok" ? "✓" : v.tone === "bad" ? "✗" : "◐") : "–"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.97rem] font-medium">
              {shortPrompt(item.question, 90)}
            </span>
            <span className="block text-xs text-text-muted">
              {TYPE_LABELS[item.question.type]} · {v ? v.title : "Skipped"}
              {item.timeTakenMs > 0 && ` · ${formatDuration(item.timeTakenMs)}`}
            </span>
          </span>
          <span
            aria-hidden
            className="text-text-muted transition-transform group-data-[state=open]:rotate-180"
          >
            ⌄
          </span>
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
            <p className="text-sm text-text-muted">You skipped this one.</p>
          )}
        </Collapsible.Content>
      </Collapsible.Root>
    </li>
  );
}
