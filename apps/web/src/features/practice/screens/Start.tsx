import { useMemo, useState } from "react";
import { useAsync } from "../lib/hooks";
import type {
  PracticeOverview,
  PracticeScopeOption,
  PracticeStore,
  QuestionType,
  SessionState,
} from "../types";
import { PracticeApiError, QUESTION_TYPES, TYPE_LABELS } from "../types";
import { Button, Card, ErrorNote, Spinner } from "../ui/primitives";

const LENGTHS = [5, 10, 20];

function defaultScope(
  o: PracticeOverview,
  currentNodeId?: string | null,
): PracticeScopeOption | null {
  return (
    o.scopes.find((s) => currentNodeId && s.id === `node:${currentNodeId}`) ??
    o.scopes.find((s) => s.kind === "exam") ??
    o.scopes.find((s) => s.kind === "node") ??
    o.scopes[0] ??
    null
  );
}

export function Start({
  store,
  currentNodeId,
  refreshKey = 0,
  onStarted,
  onResume,
  onOpenView,
}: {
  store: PracticeStore;
  currentNodeId?: string | null;
  refreshKey?: number;
  onStarted: (session: SessionState) => void;
  onResume: (sessionId: string) => void;
  onOpenView: (view: "cards" | "notebook") => void;
}) {
  const { data, error, loading, reload } = useAsync(
    () => store.getOverview({ currentNodeId: currentNodeId ?? null }),
    [store, currentNodeId, refreshKey],
  );
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [formats, setFormats] = useState<Set<QuestionType> | null>(null);
  const [length, setLength] = useState<number | "all">(10);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const scope = useMemo(
    () =>
      data?.scopes.find((s) => s.id === scopeId) ??
      (data ? defaultScope(data, currentNodeId) : null),
    [data, scopeId, currentNodeId],
  );

  // Without a choice of her own, every type that has questions is on.
  const available = useMemo(
    () => (scope ? QUESTION_TYPES.filter((t) => scope.counts[t] > 0) : []),
    [scope],
  );
  const chosen = useMemo(
    () =>
      scope?.dueOnly
        ? new Set<QuestionType>(["flashcard"])
        : new Set(available.filter((t) => !formats || formats.has(t))),
    [available, formats, scope],
  );
  const total = scope ? [...chosen].reduce((n, t) => n + scope.counts[t], 0) : 0;
  const lengthOptions = LENGTHS.filter((n) => n < total);
  const effective = length === "all" || length >= total ? total : length;

  if (loading && !data) return <Spinner label="Getting things ready" />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const toggle = (t: QuestionType) => {
    const next = new Set(chosen);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setFormats(next);
  };

  const start = async () => {
    if (!scope || starting || effective === 0) return;
    setStarting(true);
    setProblem(null);
    try {
      const s = await store.startSession({
        scope: scope.scope,
        formats: [...chosen],
        length: Math.max(1, effective),
        ...(scope.dueOnly ? { dueOnly: true } : {}),
      });
      onStarted(s);
    } catch (e) {
      setProblem(
        e instanceof PracticeApiError || e instanceof Error ? e.message : "Could not start.",
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-8" data-testid="start">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Practice</h1>
        <p className="text-text-muted">Choose what to work on. One tap starts a session.</p>
      </header>

      {data.unfinished && (
        <Card
          className="flex flex-col gap-3 border-accent p-5 sm:flex-row sm:items-center"
          data-testid="resume-card"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Pick up where you left off</p>
            <p className="text-sm text-text-muted">
              {data.unfinished.scopeLabel}: {data.unfinished.answered} of {data.unfinished.total}{" "}
              answered
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              data-testid="resume-session"
              onClick={() => onResume((data.unfinished as { id: string }).id)}
            >
              Resume
            </Button>
            <Button
              variant="quiet"
              onClick={async () => {
                await store.abandonSession((data.unfinished as { id: string }).id);
                reload();
              }}
            >
              Discard
            </Button>
          </div>
        </Card>
      )}

      <dl className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onOpenView("cards")}
          className="pr-card min-h-20 p-4 text-left transition-colors hover:bg-surface-muted"
        >
          <dt className="text-sm text-text-muted">Cards due today</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid="due-today">
            {data.dueToday}
          </dd>
        </button>
        <button
          type="button"
          onClick={() => onOpenView("notebook")}
          className="pr-card min-h-20 p-4 text-left transition-colors hover:bg-surface-muted"
        >
          <dt className="text-sm text-text-muted">In your notebook</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid="notebook-size">
            {data.notebookSize}
          </dd>
        </button>
      </dl>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-base font-semibold">What to practise</legend>
        <div className="grid gap-2.5 md:grid-cols-2">
          {data.scopes.map((s) => {
            const on = scope?.id === s.id;
            return (
              <label
                key={s.id}
                className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  on
                    ? "border-accent bg-[var(--pr-accent-soft)]"
                    : "border-border bg-surface hover:bg-surface-muted"
                }`}
              >
                <input
                  type="radio"
                  name="scope"
                  className="size-5 accent-[var(--color-accent)]"
                  checked={on}
                  onChange={() => {
                    setScopeId(s.id);
                    setFormats(null);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.label}</span>
                  {s.detail && <span className="block text-sm text-text-muted">{s.detail}</span>}
                </span>
                <span className="text-sm tabular-nums text-text-muted">{s.total}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {scope && !scope.dueOnly && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-base font-semibold">Question types</legend>
          <div className="flex flex-wrap gap-2">
            {QUESTION_TYPES.map((t) => {
              const n = scope.counts[t];
              return (
                <button
                  key={t}
                  type="button"
                  disabled={n === 0}
                  aria-pressed={chosen.has(t)}
                  data-testid={`format-${t}`}
                  onClick={() => toggle(t)}
                  className="min-h-11 rounded-full border border-border bg-surface px-4 text-sm font-medium transition-colors enabled:hover:bg-surface-muted aria-pressed:border-accent aria-pressed:bg-[var(--pr-accent-soft)] aria-pressed:text-accent disabled:opacity-40"
                >
                  {TYPE_LABELS[t]} <span className="tabular-nums text-text-muted">{n}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {total > 0 && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-base font-semibold">How many</legend>
          <div className="flex flex-wrap gap-2">
            {lengthOptions.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={length === n}
                onClick={() => setLength(n)}
                className="min-h-11 min-w-14 rounded-full border border-border bg-surface px-4 text-sm font-medium tabular-nums transition-colors hover:bg-surface-muted aria-pressed:border-accent aria-pressed:bg-[var(--pr-accent-soft)] aria-pressed:text-accent"
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={length === "all" || !lengthOptions.includes(length)}
              onClick={() => setLength("all")}
              className="min-h-11 rounded-full border border-border bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-muted aria-pressed:border-accent aria-pressed:bg-[var(--pr-accent-soft)] aria-pressed:text-accent"
            >
              All {total}
            </button>
          </div>
        </fieldset>
      )}

      {problem && <ErrorNote message={problem} />}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-bg/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button
          variant="primary"
          size="lg"
          className="w-full md:w-auto md:min-w-64"
          data-testid="start-session"
          disabled={starting || effective === 0}
          onClick={start}
        >
          {effective === 0
            ? "Nothing to practise here yet"
            : starting
              ? "Starting..."
              : `Start ${effective} ${effective === 1 ? "question" : "questions"}`}
        </Button>
      </div>
    </div>
  );
}
