import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Notice } from "../../../components/ui/notice";
import { PageHeader } from "../../../components/ui/page-header";
import { EmptyState, Spinner } from "../../../components/ui/states";
import { formatDay, localDate } from "../lib/dates";
import { useAsync } from "../lib/hooks";
import type { NotebookItem, PracticeStore, SessionState } from "../types";
import { TYPE_LABELS } from "../types";
import { Markdown } from "../ui/Markdown";

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
      <PageHeader
        title="Missed questions"
        description="Questions you got wrong wait here. Answer one correctly and it leaves. Calculations need two correct answers in a row."
        actions={
          items.length > 0 ? (
            <Button variant="primary" data-testid="retry-all" onClick={() => void retry()}>
              Retry all {items.length}
            </Button>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Your notebook is empty" headingLevel={3} compact>
          Nothing is waiting. When you miss a question it will appear here with the reason, so you
          can come back to it.
        </EmptyState>
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
      <Card padding="lg" className="space-y-3" data-testid="notebook-row">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{TYPE_LABELS[entry.type]}</Badge>
          {item.origin && <Badge tone="neutral">{item.origin}</Badge>}
          <span className="text-caption text-text-muted">
            Missed {entry.timesMissed} {entry.timesMissed === 1 ? "time" : "times"}, last{" "}
            {formatDay(localDate(new Date(entry.lastMissedAt)), { weekday: undefined })}
          </span>
        </div>
        <div className="line-clamp-4 text-body font-medium">
          <Markdown text={item.promptText} />
        </div>
        <dl className="grid gap-3 text-ui md:grid-cols-2">
          <div className="rounded-card bg-surface-muted p-3.5">
            <dt className="text-caption font-semibold text-text-muted">Why it is here</dt>
            <dd className="mt-1">{item.reason ?? "You answered it incorrectly."}</dd>
          </div>
          <div className="rounded-card bg-surface-muted p-3.5">
            <dt className="text-caption font-semibold text-text-muted">How it leaves</dt>
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
