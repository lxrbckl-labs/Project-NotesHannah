import { useCallback, useEffect, useState } from "react";
import { formatDay } from "../practice/lib/dates";
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Empty,
  ErrorNote,
  ProgressBar,
  Spinner,
} from "../practice/ui/primitives";
import { ExamForm } from "./ExamForm";
import type { ExamInput, ExamSummary, ExamsApi, PickNodes } from "./types";

export function daysLabel(days: number): string {
  if (days < 0) return days === -1 ? "Yesterday" : `${-days} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function useExams(api: ExamsApi, refreshKey: number) {
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setExams(await api.listExams());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load exams.");
    }
  }, [api]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey reloads on demand
  useEffect(() => void reload(), [reload, refreshKey]);
  return { exams, error, reload };
}

function ProgressLine({ exam }: { exam: ExamSummary }) {
  const p = exam.progress;
  return (
    <div className="space-y-1.5">
      <ProgressBar
        value={p.attempted}
        max={Math.max(1, p.questionCount)}
        label={`${p.attempted} of ${p.questionCount} questions practised`}
      />
      <p className="text-sm text-text-muted" data-testid="exam-progress">
        Practised {p.attempted} of {p.questionCount} questions
        {p.inNotebook > 0 && ` · ${p.inNotebook} in your notebook`}
        {p.dueCards > 0 && ` · ${p.dueCards} ${p.dueCards === 1 ? "card" : "cards"} due`}
      </p>
    </div>
  );
}

/** A compact card for the home screen: the next few exams with days remaining and review progress. */
export function UpcomingExamsCard({
  api,
  onPractice,
  onOpenPlanner,
  refreshKey = 0,
  limit = 3,
}: {
  api: ExamsApi;
  onPractice: (examId: string) => void;
  onOpenPlanner?: () => void;
  refreshKey?: number;
  limit?: number;
}) {
  const { exams, error } = useExams(api, refreshKey);
  const upcoming = (exams ?? []).filter((e) => e.daysRemaining >= 0).slice(0, limit);
  if (error) return <ErrorNote message={error} />;
  if (!exams) return null;
  return (
    <Card
      className="space-y-4 p-5"
      as="section"
      aria-labelledby="upcoming-exams"
      data-testid="upcoming-exams"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="upcoming-exams" className="text-base font-semibold">
          Upcoming exams
        </h2>
        {onOpenPlanner && (
          <Button variant="quiet" size="sm" onClick={onOpenPlanner}>
            Plan
          </Button>
        )}
      </div>
      {upcoming.length === 0 ? (
        <p className="text-sm text-text-muted">
          No exams coming up. Add one to see how your review is going.
        </p>
      ) : (
        <ul className="space-y-4">
          {upcoming.map((e) => (
            <li key={e.id} className="space-y-2" data-testid="upcoming-exam">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-medium">{e.title}</p>
                <span
                  className="shrink-0 text-sm font-semibold tabular-nums text-accent"
                  data-testid="days-remaining"
                >
                  {daysLabel(e.daysRemaining)}
                </span>
              </div>
              <ProgressLine exam={e} />
              <Button variant="secondary" size="sm" onClick={() => onPractice(e.id)}>
                Practise for this
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The exam planner: exams per course, with date, coverage and review progress. */
export function ExamPlanner({
  api,
  pickNodes,
  onPractice,
  refreshKey = 0,
}: {
  api: ExamsApi;
  pickNodes: PickNodes;
  onPractice: (examId: string) => void;
  refreshKey?: number;
}) {
  const { exams, error, reload } = useExams(api, refreshKey);
  const [editing, setEditing] = useState<ExamSummary | "new" | null>(null);
  const [deleting, setDeleting] = useState<ExamSummary | null>(null);

  if (error && !exams) return <ErrorNote message={error} onRetry={() => void reload()} />;
  if (!exams) return <Spinner label="Loading exams" />;

  const courses = [...new Set(exams.map((e) => e.course))];
  const save = async (input: ExamInput) => {
    if (editing && editing !== "new") await api.updateExam(editing.id, input);
    else await api.createExam(input);
    await reload();
  };

  return (
    <div className="space-y-6" data-testid="exam-planner">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Exams</h1>
          <p className="max-w-prose text-text-muted">
            Add an exam and what it covers. Practice sessions can then draw from exactly that
            material.
          </p>
        </div>
        <Button variant="primary" data-testid="add-exam" onClick={() => setEditing("new")}>
          Add an exam
        </Button>
      </header>

      {exams.length === 0 ? (
        <Empty
          title="No exams yet"
          action={
            <Button variant="primary" onClick={() => setEditing("new")}>
              Add your first exam
            </Button>
          }
        >
          Pick a date and the lectures it covers, and this page shows how much you have reviewed.
        </Empty>
      ) : (
        courses.map((course) => (
          <section key={course} aria-labelledby={`course-${course}`} className="space-y-3">
            <h2
              id={`course-${course}`}
              className="text-sm font-semibold uppercase tracking-wide text-text-muted"
            >
              {course}
            </h2>
            <ul className="grid gap-4 lg:grid-cols-2">
              {exams
                .filter((e) => e.course === course)
                .map((e) => (
                  <li key={e.id}>
                    <Card
                      className="h-full space-y-4 p-5"
                      data-testid="exam-card"
                      data-days={e.daysRemaining}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold">{e.title}</h3>
                          <p className="text-sm text-text-muted">
                            {formatDay(e.date, { year: "numeric" })}
                          </p>
                        </div>
                        <Chip
                          tone={e.daysRemaining >= 0 && e.daysRemaining <= 3 ? "part" : "accent"}
                        >
                          <span data-testid="days-remaining">{daysLabel(e.daysRemaining)}</span>
                        </Chip>
                      </div>
                      <ul className="flex flex-wrap gap-2" aria-label="Covers">
                        {e.coverage.map((c) => (
                          <li key={c.id}>
                            <Chip>
                              {c.title} · {c.questionCount}
                            </Chip>
                          </li>
                        ))}
                      </ul>
                      <ProgressLine exam={e} />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          data-testid="practise-exam"
                          onClick={() => onPractice(e.id)}
                        >
                          Practise for this exam
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid="edit-exam"
                          onClick={() => setEditing(e)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => setDeleting(e)}
                          aria-label={`Delete ${e.title}`}
                        >
                          Delete
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}

      <ExamForm
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        exam={editing && editing !== "new" ? editing : undefined}
        courses={courses}
        pickNodes={pickNodes}
        onSave={save}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.title ?? "this exam"}?`}
        description="The exam and its coverage are removed. Your questions and answers are not affected."
        confirmLabel="Delete exam"
        cancelLabel="Keep it"
        onConfirm={async () => {
          if (deleting) await api.deleteExam(deleting.id);
          setDeleting(null);
          await reload();
        }}
      />
    </div>
  );
}
