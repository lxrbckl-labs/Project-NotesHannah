import type { ConceptSummary, FilterRow } from "@notes/schema";
import { SearchX } from "lucide-react";
import { useState } from "react";
import { Card as SharedCard } from "../../components/ui/card";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { FINDER_QUESTIONS, type FinderQuestion } from "./model/finder";
import { pluralise } from "./model/text";
import { useConcepts } from "./ui/context";
import { useAsync } from "./ui/hooks";
import { Card, CiteList, ConceptLink, ConceptPicker, TypeBadge } from "./ui/parts";

/** Cross-course questions (F5), asked in plain words. */
export function Finder() {
  const [question, setQuestion] = useState<FinderQuestion>(FINDER_QUESTIONS[0] as FinderQuestion);
  const [target, setTarget] = useState<ConceptSummary | null>(null);
  return (
    <div className="grid gap-4">
      <Card className="grid gap-4">
        <div>
          <h2 className="font-display text-title font-semibold">Ask your notes a question</h2>
          <p className="mt-1 text-ui text-text-muted">
            Answers come from the structured notes your agents filed, across every course, each with
            the pages it rests on.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Question"
          className="grid gap-2 md:grid-cols-2 xl:grid-cols-3"
        >
          {FINDER_QUESTIONS.map((q) => {
            const on = q.id === question.id;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a radio styled as a card
              <button
                key={q.id}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`question-${q.id}`}
                onClick={() => {
                  setQuestion(q);
                  setTarget(null);
                }}
                className={cn(
                  "min-h-11 rounded-card border px-4 py-2.5 text-left text-ui font-medium transition-colors duration-(--duration-instant)",
                  on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border bg-bg hover:border-border-strong",
                )}
              >
                {q.lead} …
              </button>
            );
          })}
        </div>
        <div className="max-w-md">
          <ConceptPicker
            key={question.id}
            label={`${question.lead} … (choose ${question.pickLabel})`}
            types={question.pick}
            placeholder={`For example ${question.example}`}
            onPick={setTarget}
          />
        </div>
      </Card>
      {target ? (
        <Answer question={question} target={target} />
      ) : (
        <EmptyState icon={<SearchX size={26} />} title="Pick something to look up">
          Choose {question.pickLabel} above and the answer appears here.
        </EmptyState>
      )}
    </div>
  );
}

function Answer({ question, target }: { question: FinderQuestion; target: ConceptSummary }) {
  const { store } = useConcepts();
  const result = useAsync(
    () => store.query(question.build(target.id)),
    `${question.id}:${target.id}`,
  );
  return (
    <section aria-live="polite" aria-label="Answer" data-testid="finder-answer">
      <h3 className="mb-3 font-display text-title font-semibold">
        {question.lead} {target.name}
      </h3>
      {result.status === "loading" ? (
        <LoadingList rows={3} label="Finding" />
      ) : result.status === "error" ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data.items.length === 0 ? (
        <EmptyState icon={<SearchX size={26} />} title="Nothing found">
          Nothing in your notes answers that yet. Try another, or leave a request.
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-ui text-text-muted">
            {pluralise(result.data.items.length, "result")}
          </p>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.data.items.map((row) => (
              <ResultCard key={row.concept.id} row={row} />
            ))}
          </ul>
          {result.data.truncated ? (
            <p className="mt-3 text-ui text-text-muted">
              There are more than these; the list is cut short.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function ResultCard({ row }: { row: FilterRow }) {
  return (
    <SharedCard as="li" data-testid="finder-result">
      <div className="flex flex-wrap items-center gap-2">
        <ConceptLink id={row.concept.id} className="text-body">
          {row.concept.name}
        </ConceptLink>
        <TypeBadge type={row.concept.type} />
      </div>
      <p className="mt-1 text-ui text-text-muted">
        {row.via.kind === "class" ? (
          <>
            Through its class, <ConceptLink id={row.via.class.id}>{row.via.class.name}</ConceptLink>
          </>
        ) : (
          "Filed directly"
        )}
      </p>
      {row.sharedMechanisms && row.sharedMechanisms.length > 0 ? (
        <p className="mt-1 text-ui">
          Shares{" "}
          {row.sharedMechanisms.map((m, i) => (
            <span key={m.id}>
              {i > 0 ? ", " : ""}
              <ConceptLink id={m.id}>{m.name}</ConceptLink>
            </span>
          ))}
        </p>
      ) : null}
      <div className="mt-2">
        {row.citations.length > 0 ? (
          <CiteList citations={row.citations} />
        ) : (
          <span className="text-caption text-text-muted">
            {row.generalKnowledge ? "Not from your notes" : "No source chip"}
          </span>
        )}
      </div>
    </SharedCard>
  );
}
