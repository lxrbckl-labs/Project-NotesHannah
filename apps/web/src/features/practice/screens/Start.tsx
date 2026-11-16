import { CalendarCheck, NotebookPen } from "lucide-react";
import { useMemo, useState } from "react";
import { Chip } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Notice } from "../../../components/ui/notice";
import { PageHeader } from "../../../components/ui/page-header";
import { StatTile } from "../../../components/ui/stat";
import { Spinner } from "../../../components/ui/states";
import { useAsync } from "../lib/hooks";
import type {
  PracticeOverview,
  PracticeScopeOption,
  PracticeStore,
  QuestionType,
  SessionState,
} from "../types";
import { PracticeApiError, QUESTION_TYPES, TYPE_LABELS } from "../types";
import { QUIET } from "../ui/quiet";
import { StatNumber } from "../ui/StatNumber";

const LENGTHS = [5, 10, 20];

const STAT_BUTTON =
  "block min-w-0 rounded-card text-left transition-shadow duration-(--duration-fast) hover:shadow-raised";

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
  if (error && !data)
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
      <PageHeader
        title="Practice"
        description="Choose what to work on. One tap starts a session."
      />

      {data.unfinished && (
        <Card
          hue="accent"
          padding="lg"
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          data-testid="resume-card"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-tone-text">Pick up where you left off</p>
            <p className="text-ui">
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
              variant="ghost"
              className={QUIET}
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

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => onOpenView("cards")} className={STAT_BUTTON}>
          <StatTile
            label="Cards due today"
            icon={<CalendarCheck />}
            hue="blue"
            value={<StatNumber value={data.dueToday} testId="due-today" />}
          />
        </button>
        <button type="button" onClick={() => onOpenView("notebook")} className={STAT_BUTTON}>
          <StatTile
            label="In your notebook"
            icon={<NotebookPen />}
            hue="orange"
            value={<StatNumber value={data.notebookSize} testId="notebook-size" />}
          />
        </button>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-body font-semibold">What to practise</legend>
        <div className="grid gap-2.5 md:grid-cols-2">
          {data.scopes.map((s) => {
            const on = scope?.id === s.id;
            return (
              <label
                key={s.id}
                className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-card border px-4 py-3 transition-colors duration-(--duration-instant) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  on
                    ? "border-accent bg-accent-soft"
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
                  {s.detail && (
                    <span className={`block text-ui ${on ? "" : "text-text-muted"}`}>
                      {s.detail}
                    </span>
                  )}
                </span>
                <span className={`text-ui tabular-nums ${on ? "" : "text-text-muted"}`}>
                  {s.total}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {scope && !scope.dueOnly && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-body font-semibold">Question types</legend>
          <div className="flex flex-wrap gap-x-2.5 gap-y-3.5">
            {QUESTION_TYPES.map((t) => {
              const n = scope.counts[t];
              return (
                <Chip
                  key={t}
                  disabled={n === 0}
                  pressed={chosen.has(t)}
                  data-testid={`format-${t}`}
                  onClick={() => toggle(t)}
                >
                  {TYPE_LABELS[t]} <span className="tabular-nums">{n}</span>
                </Chip>
              );
            })}
          </div>
        </fieldset>
      )}

      {total > 0 && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-body font-semibold">How many</legend>
          <div className="flex flex-wrap gap-x-2.5 gap-y-3.5">
            {lengthOptions.map((n) => (
              <Chip
                key={n}
                pressed={length === n}
                onClick={() => setLength(n)}
                className="min-w-14 justify-center tabular-nums"
              >
                {n}
              </Chip>
            ))}
            <Chip
              pressed={length === "all" || !lengthOptions.includes(length)}
              onClick={() => setLength("all")}
            >
              All {total}
            </Chip>
          </div>
        </fieldset>
      )}

      {problem && <Notice tone="danger">{problem}</Notice>}

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
