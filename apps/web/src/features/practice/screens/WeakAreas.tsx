import { Tabs } from "radix-ui";
import { useAsync } from "../lib/hooks";
import { percent } from "../lib/results";
import type { AreaRow, PracticeStore, SessionScope, SessionState, WeakAreasView } from "../types";
import { Button, Card, Chip, Empty, ErrorNote, ProgressBar, Spinner } from "../ui/primitives";

export function WeakAreas({
  store,
  onStarted,
  refreshKey = 0,
}: {
  store: PracticeStore;
  onStarted: (s: SessionState) => void;
  refreshKey?: number;
}) {
  const { data, error, loading, reload } = useAsync(
    () => store.getWeakAreas(),
    [store, refreshKey],
  );
  if (loading && !data) return <Spinner label="Looking at your answers" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const practise = async (scope: SessionScope) =>
    onStarted(
      await store.startSession({
        scope,
        formats: [
          "multiple_choice",
          "select_all",
          "matching",
          "fill_blank",
          "calculation",
          "case",
          "free_response",
        ],
        length: 10,
      }),
    );

  return (
    <div className="space-y-6" data-testid="weak-areas">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Weak areas</h1>
        <p className="max-w-prose text-text-muted">
          Accuracy by topic, from {data.totalAttempts} answers so far. We only say something once
          there is enough to go on: at least {data.thresholds.minAttempts} answers across{" "}
          {data.thresholds.minQuestions} different questions.
        </p>
      </header>
      <Tabs.Root defaultValue="concept">
        <Tabs.List
          aria-label="Group by"
          className="mb-5 inline-flex gap-1 rounded-full border border-border bg-surface-muted p-1"
        >
          {[
            ["concept", "Topics"],
            ["tag", "Tags"],
            ["node", "Lectures"],
          ].map(([v, label]) => (
            <Tabs.Trigger
              key={v}
              value={v as string}
              className="min-h-11 rounded-full px-4 text-sm font-medium text-text-muted data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="concept">
          <AreaList rows={data.byConcept} view={data} onPractise={practise} />
        </Tabs.Content>
        <Tabs.Content value="tag">
          <AreaList rows={data.byTag} view={data} onPractise={practise} />
        </Tabs.Content>
        <Tabs.Content value="node">
          <AreaList rows={data.byNode} view={data} onPractise={practise} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function AreaList({
  rows,
  view,
  onPractise,
}: {
  rows: AreaRow[];
  view: WeakAreasView;
  onPractise: (scope: SessionScope) => void;
}) {
  if (rows.length === 0)
    return (
      <Empty title="Nothing to show yet">
        Answer some questions and your areas will appear here.
      </Empty>
    );
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {rows.map((row) => (
        <li key={`${row.kind}-${row.key}`}>
          <AreaCard row={row} view={view} onPractise={onPractise} />
        </li>
      ))}
    </ul>
  );
}

function AreaCard({
  row,
  view,
  onPractise,
}: {
  row: AreaRow;
  view: WeakAreasView;
  onPractise: (scope: SessionScope) => void;
}) {
  const { stat } = row;
  const enough = stat.status !== "insufficient_data";
  const tone = stat.status === "weak" ? "part" : stat.status === "ok" ? "ok" : "neutral";
  const bar =
    stat.status === "weak"
      ? "var(--pr-partial)"
      : stat.status === "ok"
        ? "var(--pr-correct)"
        : "var(--color-text-muted)";
  return (
    <Card className="h-full space-y-3 p-5" data-testid="area-card" data-status={stat.status}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[1.02rem] font-semibold first-letter:uppercase">{row.label}</h3>
        <Chip tone={tone}>
          {stat.status === "weak"
            ? "Needs attention"
            : stat.status === "ok"
              ? "Going well"
              : "Not enough yet"}
        </Chip>
      </div>
      {enough ? (
        <>
          <ProgressBar
            value={Math.round(stat.accuracy * 100)}
            max={100}
            label={`${row.label} accuracy`}
            color={bar}
            className="!h-2"
          />
          <p className="text-sm text-text-muted">
            {stat.correct} of {stat.attempts} answers right ({percent(stat.accuracy)}) across{" "}
            {stat.questions} questions
          </p>
        </>
      ) : (
        <p className="text-sm text-text-muted" data-testid="insufficient">
          Not enough attempts yet: {stat.attempts} {stat.attempts === 1 ? "answer" : "answers"} on{" "}
          {stat.questions} {stat.questions === 1 ? "question" : "questions"}. We need at least{" "}
          {view.thresholds.minAttempts} answers across {view.thresholds.minQuestions} questions
          before saying anything.
        </p>
      )}
      {row.practiceScope && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPractise(row.practiceScope as SessionScope)}
        >
          Practise this
        </Button>
      )}
    </Card>
  );
}
