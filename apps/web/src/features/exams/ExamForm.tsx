import { X } from "lucide-react";
import { useId, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Field, TextInput } from "../../components/ui/field";
import { Notice } from "../../components/ui/notice";
import { Sheet } from "../../components/ui/sheet";
import type { CoverageNode, ExamInput, ExamSummary, PickedNode, PickNodes } from "./types";

/** Create or edit an exam: course, title, date and which lectures/folders it covers. */
export function ExamForm(props: ExamFormProps) {
  // The sheet only exists while open, so its fields start fresh every time.
  return props.open ? <ExamFormSheet {...props} /> : null;
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

function ExamFormSheet({ onOpenChange, exam, courses, pickNodes, onSave }: ExamFormProps) {
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

  const err = (msg: string | null) => (touched ? msg : null);

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={exam ? "Edit exam" : "Add an exam"}
      placement="center"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="min-w-32"
            disabled={saving}
            data-testid="exam-save"
            onClick={() => void save()}
          >
            {saving ? "Saving..." : exam ? "Save changes" : "Add exam"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Course" error={err(problems.course)}>
          {(p) => (
            <>
              <TextInput
                {...p}
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
            </>
          )}
        </Field>
        <Field label="Title" error={err(problems.title)}>
          {(p) => (
            <TextInput
              {...p}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
              placeholder="e.g. Midterm"
              data-testid="exam-title"
            />
          )}
        </Field>
        <Field label="Date" error={err(problems.date)}>
          {(p) => (
            <TextInput
              {...p}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="exam-date"
            />
          )}
        </Field>
        <div>
          <p className="mb-1.5 text-ui font-medium">Covers</p>
          {coverage.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-2" aria-label="Covered lectures and folders">
              {coverage.map((c) => (
                <li key={c.id}>
                  <CoverageChip
                    title={c.title}
                    onRemove={() => setCoverage(coverage.filter((x) => x.id !== c.id))}
                  />
                </li>
              ))}
            </ul>
          )}
          <Button onClick={() => void choose()} data-testid="exam-choose">
            {coverage.length ? "Change coverage" : "Choose lectures or folders"}
          </Button>
          {err(problems.coverage) ? (
            <p role="alert" className="mt-1.5 text-ui text-danger">
              {err(problems.coverage)}
            </p>
          ) : null}
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Sheet>
  );
}

/** A removable chip (the shared Chip has no remove button yet). */
function CoverageChip({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <span
      data-hue="accent"
      className="inline-flex max-w-full items-center gap-1 rounded-pill bg-tone-soft pl-3 text-label font-medium text-tone-text"
    >
      <span className="min-w-0 truncate">{title}</span>
      <IconButton label={`Remove ${title}`} size="sm" onClick={onRemove} className="text-tone-text">
        <X size={14} />
      </IconButton>
    </span>
  );
}

function toPicked(c: CoverageNode): PickedNode {
  return { id: c.id, title: c.title, path: c.path };
}
