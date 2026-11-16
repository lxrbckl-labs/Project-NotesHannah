import { Dialog } from "radix-ui";
import { useId, useState } from "react";
import { Button, Chip, ErrorNote } from "../practice/ui/primitives";
import type { CoverageNode, ExamInput, ExamSummary, PickedNode, PickNodes } from "./types";

/** Create or edit an exam: course, title, date and which lectures/folders it covers. */
export function ExamForm(props: ExamFormProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pr-fade fixed inset-0 z-[60] bg-black/40" />
        {/* Content only exists while open, so its fields start fresh every time. */}
        <ExamFormContent {...props} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ExamFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The exam being edited; omitted when creating. */
  exam?: ExamSummary | undefined;
  courses: string[];
  pickNodes: PickNodes;
  onSave: (input: ExamInput) => Promise<void>;
}

function ExamFormContent({ onOpenChange, exam, courses, pickNodes, onSave }: ExamFormProps) {
  const uid = useId();
  const [course, setCourse] = useState(exam?.course ?? courses[0] ?? "");
  const [title, setTitle] = useState(exam?.title ?? "");
  const [date, setDate] = useState(exam?.date ?? "");
  const [coverage, setCoverage] = useState<PickedNode[]>((exam?.coverage ?? []).map(toPicked));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const problems = {
    course: course.trim() ? null : "Name the course.",
    title: title.trim() ? null : "Give the exam a title.",
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? null : "Pick the exam date.",
    coverage: coverage.length ? null : "Choose at least one lecture or folder.",
  };
  const invalid = Object.values(problems).some(Boolean);

  const choose = async () => {
    const picked = await pickNodes({
      selected: coverage.map((c) => c.id),
      title: "What does this exam cover?",
    });
    if (picked) setCoverage(picked);
  };

  const save = async () => {
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        course: course.trim(),
        title: title.trim(),
        date,
        nodeIds: coverage.map((c) => c.id),
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the exam.");
    } finally {
      setSaving(false);
    }
  };

  const field =
    "min-h-12 w-full rounded-2xl border border-border bg-surface px-4 text-base outline-none focus:border-accent";
  const err = (msg: string | null) =>
    touched && msg ? (
      <p className="mt-1 text-sm" style={{ color: "var(--pr-wrong)" }} role="alert">
        {msg}
      </p>
    ) : null;

  return (
    <Dialog.Content
      className="pr-root pr-rise pr-card fixed inset-x-0 bottom-0 z-[61] mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-b-none md:inset-y-auto md:top-1/2 md:-translate-y-1/2 md:rounded-b-[20px]"
      aria-describedby={undefined}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <Dialog.Title className="text-lg font-semibold">
          {exam ? "Edit exam" : "Add an exam"}
        </Dialog.Title>
        <Dialog.Close asChild>
          <Button variant="quiet" aria-label="Close" className="size-11 !px-0">
            <span aria-hidden>✕</span>
          </Button>
        </Dialog.Close>
      </div>
      <form
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <label
            htmlFor={`${uid}-course`}
            className="mb-1.5 block text-sm font-medium text-text-muted"
          >
            Course
          </label>
          <input
            id={`${uid}-course`}
            className={field}
            list={`${uid}-courses`}
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            autoComplete="off"
            data-testid="exam-course"
          />
          <datalist id={`${uid}-courses`}>
            {courses.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {err(problems.course)}
        </div>
        <div>
          <label
            htmlFor={`${uid}-title`}
            className="mb-1.5 block text-sm font-medium text-text-muted"
          >
            Title
          </label>
          <input
            id={`${uid}-title`}
            className={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
            placeholder="e.g. Midterm"
            data-testid="exam-title"
          />
          {err(problems.title)}
        </div>
        <div>
          <label
            htmlFor={`${uid}-date`}
            className="mb-1.5 block text-sm font-medium text-text-muted"
          >
            Date
          </label>
          <input
            id={`${uid}-date`}
            type="date"
            className={field}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="exam-date"
          />
          {err(problems.date)}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-text-muted">Covers</p>
          {coverage.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-2" aria-label="Covered lectures and folders">
              {coverage.map((c) => (
                <li key={c.id}>
                  <Chip tone="accent" className="!pr-1">
                    {c.title}
                    <button
                      type="button"
                      aria-label={`Remove ${c.title}`}
                      onClick={() => setCoverage(coverage.filter((x) => x.id !== c.id))}
                      className="grid size-9 place-items-center rounded-full hover:bg-black/5"
                    >
                      <span aria-hidden>✕</span>
                    </button>
                  </Chip>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" onClick={() => void choose()} data-testid="exam-choose">
            {coverage.length ? "Change coverage" : "Choose lectures or folders"}
          </Button>
          {err(problems.coverage)}
        </div>
        {error && <ErrorNote message={error} />}
      </form>
      <div className="flex gap-2 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <Dialog.Close asChild>
          <Button variant="quiet">Cancel</Button>
        </Dialog.Close>
        <Button
          variant="primary"
          className="ml-auto min-w-32"
          disabled={saving}
          data-testid="exam-save"
          onClick={() => void save()}
        >
          {saving ? "Saving..." : exam ? "Save changes" : "Add exam"}
        </Button>
      </div>
    </Dialog.Content>
  );
}

function toPicked(c: CoverageNode): PickedNode {
  return { id: c.id, title: c.title, path: c.path };
}
