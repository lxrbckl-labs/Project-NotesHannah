import { Check, Minus, TriangleAlert } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Notice } from "../../../components/ui/notice";
import { PageHeader } from "../../../components/ui/page-header";
import { ProgressBar } from "../../../components/ui/progress";
import { Tab, TabList, TabPanel, Tabs } from "../../../components/ui/segmented";
import { EmptyState, Spinner } from "../../../components/ui/states";
import { FEEDBACK_HUE } from "../../../lib/roles";
import { useAsync } from "../lib/hooks";
import { percent } from "../lib/results";
import type { AreaRow, PracticeStore, SessionScope, SessionState, WeakAreasView } from "../types";

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
  if (error)
    return (
      <Notice
        tone="danger"
        action={
          <Button size="sm" onClick={reload}>
            Try again
          </Button>
        }
      >
        {error}
      </Notice>
    );
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
      <PageHeader
        title="Weak areas"
        description={`Accuracy by topic, from ${data.totalAttempts} answers so far. We only say something once there is enough to go on: at least ${data.thresholds.minAttempts} answers across ${data.thresholds.minQuestions} different questions.`}
      />
      <Tabs defaultValue="concept">
        <TabList label="Group by">
          <Tab value="concept">Topics</Tab>
          <Tab value="tag">Tags</Tab>
          <Tab value="node">Lectures</Tab>
        </TabList>
        <TabPanel value="concept">
          <AreaList rows={data.byConcept} view={data} onPractise={practise} />
        </TabPanel>
        <TabPanel value="tag">
          <AreaList rows={data.byTag} view={data} onPractise={practise} />
        </TabPanel>
        <TabPanel value="node">
          <AreaList rows={data.byNode} view={data} onPractise={practise} />
        </TabPanel>
      </Tabs>
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
      <EmptyState title="Nothing to show yet" headingLevel={3} compact>
        Answer some questions and your areas will appear here.
      </EmptyState>
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
  // Needs attention is the partial role (yellow), going well the correct role (green), too early grey.
  const hue =
    stat.status === "weak"
      ? FEEDBACK_HUE.partial
      : stat.status === "ok"
        ? FEEDBACK_HUE.correct
        : FEEDBACK_HUE.skipped;
  return (
    <Card
      padding="lg"
      className="h-full space-y-3"
      data-testid="area-card"
      data-status={stat.status}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-body font-semibold first-letter:uppercase">{row.label}</h3>
        <Badge
          hue={hue}
          icon={
            stat.status === "weak" ? (
              <TriangleAlert />
            ) : stat.status === "ok" ? (
              <Check />
            ) : (
              <Minus />
            )
          }
        >
          {stat.status === "weak"
            ? "Needs attention"
            : stat.status === "ok"
              ? "Going well"
              : "Not enough yet"}
        </Badge>
      </div>
      {enough ? (
        <>
          <ProgressBar
            value={Math.round(stat.accuracy * 100)}
            max={100}
            label={`${row.label} accuracy`}
            hue={hue}
          />
          <p className="text-ui text-text-muted">
            {stat.correct} of {stat.attempts} answers right ({percent(stat.accuracy)}) across{" "}
            {stat.questions} questions
          </p>
        </>
      ) : (
        <p className="text-ui text-text-muted" data-testid="insufficient">
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
