import { formatDay, localDate } from "../lib/dates";
import { useAsync } from "../lib/hooks";
import type { NotebookItem, PracticeStore, SessionState } from "../types";
import { TYPE_LABELS } from "../types";
import { Markdown } from "../ui/Markdown";
import { Button, Card, Chip, Empty, ErrorNote, Spinner } from "../ui/primitives";

export function Notebook({
  store,
  onStarted,
  refreshKey = 0,
}: {
  store: PracticeStore;
  onStarted: (s: SessionState) => void;
  refreshKey?: number;
}) {
  const { data, error, loading, reload } = useAsync(
    () => store.listNotebook(),
    [store, refreshKey],
  );
  if (loading && !data) return <Spinner label="Opening your notebook" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const items = data ?? [];

  const retry = async (ids?: string[]) => {
    const formats = [...new Set(items.map((i) => i.entry.type))];
    const picked = ids ? items.filter((i) => ids.includes(i.entry.questionId)) : items;
    onStarted(
      await store.startSession({
        scope: { kind: "missed" },
        formats: [...new Set(picked.map((i) => i.entry.type))].length
          ? [...new Set(picked.map((i) => i.entry.type))]
          : formats,
        length: Math.min(100, Math.max(1, picked.length)),
        ...(ids ? { questionIds: ids } : {}),
      }),
    );
  };

  return (
    <div className="space-y-6" data-testid="notebook">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Missed questions</h1>
          <p className="max-w-prose text-text-muted">
            Questions you got wrong wait here. Answer one correctly and it leaves. Calculations need
            two correct answers in a row.
          </p>
        </div>
        {items.length > 0 && (
          <Button variant="primary" data-testid="retry-all" onClick={() => void retry()}>
            Retry all {items.length}
          </Button>
        )}
      </header>
      {items.length === 0 ? (
        <Empty title="Your notebook is empty">
          Nothing is waiting. When you miss a question it will appear here with the reason, so you
          can come back to it.
        </Empty>
      ) : (
        <ul className="space-y-3" aria-label="Missed questions">
          {items.map((item) => (
            <NotebookRow
              key={item.entry.questionId}
              item={item}
              onRetry={() => void retry([item.entry.questionId])}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotebookRow({ item, onRetry }: { item: NotebookItem; onRetry: () => void }) {
  const { entry } = item;
  return (
    <li>
      <Card className="space-y-3 p-5" data-testid="notebook-row">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{TYPE_LABELS[entry.type]}</Chip>
          {item.origin && <Chip>{item.origin}</Chip>}
          <span className="text-xs text-text-muted">
            Missed {entry.timesMissed} {entry.timesMissed === 1 ? "time" : "times"}, last{" "}
            {formatDay(localDate(new Date(entry.lastMissedAt)), { weekday: undefined })}
          </span>
        </div>
        <div className="line-clamp-4 text-[1.02rem] font-medium">
          <Markdown text={item.promptText} />
        </div>
        <dl className="grid gap-3 text-[0.93rem] md:grid-cols-2">
          <div className="rounded-2xl bg-surface-muted p-3.5">
            <dt className="text-xs font-semibold text-text-muted">Why it is here</dt>
            <dd className="mt-1">{item.reason ?? "You answered it incorrectly."}</dd>
          </div>
          <div className="rounded-2xl bg-surface-muted p-3.5">
            <dt className="text-xs font-semibold text-text-muted">How it leaves</dt>
            <dd className="mt-1">{item.leaveRule}</dd>
          </div>
        </dl>
        <Button variant="secondary" size="sm" onClick={onRetry} data-testid="retry-one">
          Retry this one
        </Button>
      </Card>
    </li>
  );
}
