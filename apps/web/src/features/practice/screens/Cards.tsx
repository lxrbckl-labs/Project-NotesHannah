import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Notice } from "../../../components/ui/notice";
import { PageHeader } from "../../../components/ui/page-header";
import { Spinner } from "../../../components/ui/states";
import { formatDay } from "../lib/dates";
import { useAsync } from "../lib/hooks";
import type { DueByDay, PracticeStore, SessionState } from "../types";

export function DueChart({ days }: { days: DueByDay["days"] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <figure className="space-y-3" data-testid="due-chart">
      <figcaption className="text-ui font-medium text-text-muted">
        Cards due, next two weeks
      </figcaption>
      <div className="flex h-40 items-end gap-1 sm:gap-1.5" aria-hidden>
        {days.map((d, i) => (
          <div
            key={d.date}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            <span className="text-caption tabular-nums text-text-muted">{d.count || ""}</span>
            <div
              className={`w-full max-w-8 rounded-t-control ${i === 0 ? "bg-accent" : "bg-accent/45"}`}
              style={{ height: `${d.count === 0 ? 3 : (d.count / max) * 100}%`, minHeight: 3 }}
              data-count={d.count}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 sm:gap-1.5" aria-hidden>
        {days.map((d, i) => (
          <span
            key={d.date}
            className="min-w-0 flex-1 text-center text-caption leading-tight text-text-muted"
          >
            {i === 0
              ? "Today"
              : formatDay(d.date, { weekday: "narrow", month: undefined, day: "numeric" })}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Cards due by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Cards due</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{formatDay(d.date)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Cards({
  store,
  onStarted,
  refreshKey = 0,
}: {
  store: PracticeStore;
  onStarted: (s: SessionState) => void;
  refreshKey?: number;
}) {
  const { data, error, loading, reload } = useAsync(
    () => store.getDueByDay(14),
    [store, refreshKey],
  );
  if (loading && !data) return <Spinner label="Counting your cards" />;
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
  const upcoming = data.days.slice(1).reduce((n, d) => n + d.count, 0);
  const start = async () =>
    onStarted(
      await store.startSession({
        scope: { kind: "all" },
        formats: ["flashcard"],
        length: Math.max(1, data.today),
        dueOnly: true,
      }),
    );
  return (
    <div className="space-y-6" data-testid="cards">
      <PageHeader
        title="Flashcards"
        description="Cards come back just before you would forget them. No need to catch up on a missed day."
      />
      <Card
        padding="lg"
        className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="text-ui text-text-muted">Due today</p>
          <p
            data-hue="blue"
            className="font-display text-5xl font-semibold tabular-nums tracking-tight text-tone-text"
            data-testid="cards-due-today"
          >
            {data.today}
          </p>
          <p className="mt-1 text-ui text-text-muted">
            {data.newCards} new {data.newCards === 1 ? "card" : "cards"} still to meet · {upcoming}{" "}
            coming up
          </p>
        </div>
        <Button
          variant="primary"
          size="lg"
          disabled={data.today === 0}
          data-testid="start-review"
          onClick={() => void start()}
        >
          {data.today === 0
            ? "All caught up"
            : `Review ${data.today} ${data.today === 1 ? "card" : "cards"}`}
        </Button>
      </Card>
      <Card padding="lg">
        <DueChart days={data.days} />
      </Card>
    </div>
  );
}
