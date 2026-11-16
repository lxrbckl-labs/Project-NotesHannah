import { formatDay } from "../lib/dates";
import { useAsync } from "../lib/hooks";
import type { DueByDay, PracticeStore, SessionState } from "../types";
import { Button, Card, ErrorNote, Spinner } from "../ui/primitives";

export function DueChart({ days }: { days: DueByDay["days"] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <figure className="space-y-3" data-testid="due-chart">
      <figcaption className="text-sm font-medium text-text-muted">
        Cards due, next two weeks
      </figcaption>
      <div className="flex h-40 items-end gap-1 sm:gap-1.5" aria-hidden>
        {days.map((d, i) => (
          <div
            key={d.date}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            <span className="text-[0.7rem] tabular-nums text-text-muted">{d.count || ""}</span>
            <div
              className={`w-full max-w-8 rounded-t-lg ${i === 0 ? "bg-accent" : "bg-accent/45"}`}
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
            className="min-w-0 flex-1 text-center text-[0.65rem] leading-tight text-text-muted sm:text-xs"
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
  if (error) return <ErrorNote message={error} onRetry={reload} />;
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
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Flashcards</h1>
        <p className="max-w-prose text-text-muted">
          Cards come back just before you would forget them. No need to catch up on a missed day.
        </p>
      </header>
      <Card className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-text-muted">Due today</p>
          <p
            className="text-5xl font-semibold tabular-nums tracking-tight"
            data-testid="cards-due-today"
          >
            {data.today}
          </p>
          <p className="mt-1 text-sm text-text-muted">
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
      <Card className="p-5 md:p-6">
        <DueChart days={data.days} />
      </Card>
    </div>
  );
}
