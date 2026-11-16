import { useEffect, useRef, useState } from "react";
import type {
  GradeResult,
  Reveal,
  ReviewRating,
  ServedFlashcard,
  ServedFreeResponse,
} from "../types";
import { Markdown } from "../ui/Markdown";
import { Button } from "../ui/primitives";
import { type AnswerProps, Prompt } from "./shared";

type FlashAnswer = { type: "flashcard"; rating: ReviewRating };
type FreeAnswer = { type: "free_response"; text: string; covered: number[] };

export function formatInterval(days: number): string {
  if (days < 1) return "<1 day";
  if (days === 1) return "1 day";
  if (days <= 100) return `${days} days`;
  if (days < 365) {
    const m = Math.round(days / 30);
    return `${m} ${m === 1 ? "month" : "months"}`;
  }
  const y = Math.round((days / 365) * 10) / 10;
  return `${y} ${y === 1 ? "year" : "years"}`;
}

const RATINGS: { rating: ReviewRating; label: string; hint: string }[] = [
  { rating: "again", label: "Again", hint: "I did not remember" },
  { rating: "hard", label: "Hard", hint: "With effort" },
  { rating: "good", label: "Good", hint: "I remembered" },
  { rating: "easy", label: "Easy", hint: "Instantly" },
];

export function Flashcard({
  question,
  value,
  onChange,
  onCommit,
  disabled = false,
  result = null,
  reveal,
  mode = "single",
}: AnswerProps<ServedFlashcard, FlashAnswer>) {
  const [back, setBack] = useState<Extract<Reveal, { type: "flashcard" }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flipped = back !== null;

  const show = async () => {
    if (flipped || busy || !reveal) return;
    setBusy(true);
    setError(null);
    try {
      const r = await reveal();
      if (r.type === "flashcard") setBack(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the answer.");
    } finally {
      setBusy(false);
    }
  };
  const rate = (rating: ReviewRating) => {
    if (disabled) return;
    const answer: FlashAnswer = { type: "flashcard", rating };
    onChange(answer);
    if (mode === "single") onCommit?.(answer);
  };

  // The effects below read the latest state through a ref so they run only when they should.
  const latest = useRef({ show, rate, flipped, disabled });
  latest.current = { show, rate, flipped, disabled };

  // An answered card (shown again in a review) turns itself over.
  useEffect(() => {
    if (disabled) void latest.current.show();
  }, [disabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { show, rate, flipped, disabled } = latest.current;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      if (!flipped && e.key === " " && t?.tagName !== "BUTTON") {
        e.preventDefault();
        void show();
      } else if (flipped && !disabled && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        rate(RATINGS[Number(e.key) - 1]?.rating ?? "good");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-5" data-testid="answer-flashcard">
      <div className="pr-flip" data-flipped={flipped}>
        <div className="pr-flip-inner">
          <div
            className="pr-flip-face pr-card flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center md:min-h-64"
            aria-hidden={flipped}
            inert={flipped}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Front
            </span>
            <div className="text-xl font-medium leading-snug md:text-2xl" data-testid="card-front">
              <Markdown text={question.front} />
            </div>
          </div>
          <div
            className="pr-flip-face pr-flip-back pr-card flex min-h-56 flex-col items-center justify-center gap-3 border-accent bg-[var(--pr-accent-soft)] p-6 text-center md:min-h-64"
            aria-hidden={!flipped}
            inert={!flipped}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Back
            </span>
            <div className="text-xl font-medium leading-snug md:text-2xl" data-testid="card-back">
              <Markdown text={back?.back ?? ""} />
            </div>
            {back?.explanation && (
              <div className="max-w-prose text-sm text-text-muted">
                <Markdown text={back.explanation} />
              </div>
            )}
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="pr-bad rounded-xl border px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {!flipped ? (
        <Button variant="primary" size="lg" className="w-full" onClick={show} disabled={busy}>
          {busy ? "Turning over..." : "Show answer"}
        </Button>
      ) : (
        <fieldset className="m-0 grid min-w-0 grid-cols-2 gap-2.5 border-0 p-0 sm:grid-cols-4">
          <legend className="sr-only">How well did you remember it?</legend>
          {RATINGS.map(({ rating, label, hint }, i) => (
            <button
              key={rating}
              type="button"
              disabled={disabled}
              onClick={() => rate(rating)}
              aria-pressed={value?.rating === rating}
              data-testid={`rate-${rating}`}
              className="flex min-h-16 flex-col items-center justify-center rounded-2xl border border-border bg-surface px-2 py-2 transition-colors enabled:hover:bg-surface-muted aria-pressed:border-accent aria-pressed:bg-[var(--pr-accent-soft)] disabled:opacity-70"
            >
              <span className="font-semibold">{label}</span>
              <span className="text-xs text-text-muted">
                <span className="sr-only">{hint}, next review in </span>
                {formatInterval(back?.intervals[rating] ?? 1)}
              </span>
              <span className="sr-only">Shortcut {i + 1}</span>
            </button>
          ))}
        </fieldset>
      )}
      {result && !flipped && <span className="sr-only">Answered</span>}
    </div>
  );
}

export function FreeResponse({
  question,
  value,
  onChange,
  onCommit,
  disabled = false,
  result = null,
  reveal,
  mode = "single",
}: AnswerProps<ServedFreeResponse, FreeAnswer>) {
  const [text, setText] = useState(value?.text ?? "");
  const [covered, setCovered] = useState<number[]>(value?.covered ?? []);
  const [shown, setShown] = useState<Extract<Reveal, { type: "free_response" }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const push = (t: string, c: number[]) => {
    if (mode === "part" || t.trim() || c.length)
      onChange({ type: "free_response", text: t, covered: c });
    else onChange(null);
  };
  const show = async () => {
    if (!reveal || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await reveal();
      if (r.type === "free_response") {
        setShown(r);
        push(text, covered);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the model answer.");
    } finally {
      setBusy(false);
    }
  };
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    if (disabled) void showRef.current();
  }, [disabled]);

  const toggle = (i: number) => {
    if (disabled) return;
    const next = covered.includes(i)
      ? covered.filter((c) => c !== i)
      : [...covered, i].sort((a, b) => a - b);
    setCovered(next);
    push(text, next);
  };
  const lines = result?.feedback ?? [];
  const pts =
    shown?.rubric.reduce(
      (s, r) => s + (covered.includes(shown.rubric.indexOf(r)) ? r.points : 0),
      0,
    ) ?? 0;
  const max = shown?.rubric.reduce((s, r) => s + r.points, 0) ?? 0;

  return (
    <div className="space-y-5" data-testid="answer-free_response">
      <Prompt text={question.prompt} />
      <div>
        <label htmlFor="fr-text" className="mb-1.5 block text-sm font-medium text-text-muted">
          Your answer
        </label>
        <textarea
          id="fr-text"
          value={text}
          rows={6}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            push(e.target.value, covered);
          }}
          onFocus={(e) =>
            window.setTimeout(
              () => e.target.scrollIntoView?.({ block: "center", behavior: "smooth" }),
              250,
            )
          }
          placeholder="Write it in your own words"
          className="w-full rounded-2xl border border-border bg-surface p-3.5 text-base leading-relaxed outline-none focus:border-accent"
        />
      </div>
      {!shown && (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={show}
          disabled={busy || disabled}
        >
          {busy ? "Loading..." : "Show model answer"}
        </Button>
      )}
      {error && (
        <p role="alert" className="pr-bad rounded-xl border px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {shown && (
        <div className="pr-fade space-y-4">
          <div className="rounded-2xl border border-accent bg-[var(--pr-accent-soft)] p-4">
            <h3 className="mb-1 text-sm font-semibold text-text-muted">Model answer</h3>
            <div data-testid="model-answer">
              <Markdown text={shown.modelAnswer} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Tick the key points you covered</legend>
            <ul className="space-y-2" data-testid="rubric">
              {shown.rubric.map((r, i) => {
                const got = covered.includes(i);
                return (
                  <li key={r.point}>
                    <label
                      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                        got
                          ? "border-accent bg-[var(--pr-accent-soft)]"
                          : "border-border bg-surface"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="size-5 accent-[var(--color-accent)]"
                        checked={got}
                        disabled={disabled}
                        onChange={() => toggle(i)}
                      />
                      <span className="flex-1 text-[0.97rem]">{r.point}</span>
                      <span className="text-sm text-text-muted">
                        {r.points} {r.points === 1 ? "pt" : "pts"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-sm text-text-muted" aria-live="polite">
              {pts} of {max} points
            </p>
          </fieldset>
          {mode === "single" && !disabled && (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              data-testid="submit-self"
              onClick={() => onCommit?.({ type: "free_response", text, covered })}
            >
              Save my assessment
            </Button>
          )}
        </div>
      )}
      {result && lines.length === 0 && <span className="sr-only">Answered</span>}
    </div>
  );
}

export type { GradeResult };
