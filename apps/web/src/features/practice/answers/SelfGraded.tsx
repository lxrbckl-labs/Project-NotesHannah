import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Notice } from "../../../components/ui/notice";
import { RATING_HUE } from "../../../lib/roles";
import type {
  GradeResult,
  Reveal,
  ReviewRating,
  ServedFlashcard,
  ServedFreeResponse,
} from "../types";
import { Markdown } from "../ui/Markdown";
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
          <Card
            padding="lg"
            className="pr-flip-face flex min-h-56 flex-col items-center justify-center gap-3 text-center md:min-h-64"
            aria-hidden={flipped}
            inert={flipped}
          >
            <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
              Front
            </span>
            <div className="text-title font-medium md:text-heading" data-testid="card-front">
              <Markdown text={question.front} />
            </div>
          </Card>
          <Card
            hue="accent"
            padding="lg"
            className="pr-flip-face pr-flip-back flex min-h-56 flex-col items-center justify-center gap-3 text-center md:min-h-64"
            aria-hidden={!flipped}
            inert={!flipped}
          >
            <span className="text-label font-semibold uppercase tracking-wide text-tone-text">
              Back
            </span>
            <div className="text-title font-medium md:text-heading" data-testid="card-back">
              <Markdown text={back?.back ?? ""} />
            </div>
            {back?.explanation && (
              <div className="max-w-prose text-ui">
                <Markdown text={back.explanation} />
              </div>
            )}
          </Card>
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
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
              data-hue={value?.rating === rating ? RATING_HUE[rating] : undefined}
              className={`flex min-h-16 flex-col items-center justify-center rounded-card border px-2 py-2 transition-colors duration-(--duration-instant) disabled:opacity-70 ${
                value?.rating === rating
                  ? "border-tone-border bg-tone-soft text-tone-text"
                  : "border-border bg-surface enabled:hover:bg-surface-muted"
              }`}
            >
              <span className="flex items-center gap-1.5 font-semibold">
                <span
                  aria-hidden
                  data-hue={RATING_HUE[rating]}
                  className="size-2.5 rounded-pill bg-tone-solid"
                />
                {label}
              </span>
              <span className={`text-caption ${value?.rating === rating ? "" : "text-text-muted"}`}>
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
        <label htmlFor="fr-text" className="mb-1.5 block text-ui font-medium text-text-muted">
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
          className="w-full rounded-card border border-border-strong bg-surface p-3.5 text-body leading-relaxed outline-none focus:border-accent"
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
      {error && <Notice tone="danger">{error}</Notice>}
      {shown && (
        <div className="anim-fade space-y-4">
          <div
            data-hue="accent"
            className="rounded-card border border-tone-border bg-tone-soft p-4"
          >
            <h3 className="mb-1 text-ui font-semibold text-tone-text">Model answer</h3>
            <div data-testid="model-answer">
              <Markdown text={shown.modelAnswer} />
            </div>
          </div>
          <fieldset>
            <legend className="mb-2 text-ui font-semibold">Tick the key points you covered</legend>
            <ul className="space-y-2" data-testid="rubric">
              {shown.rubric.map((r, i) => {
                const got = covered.includes(i);
                return (
                  <li key={r.point}>
                    <label
                      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-card border px-3.5 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                        got ? "border-accent bg-accent-soft" : "border-border bg-surface"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="size-5 accent-[var(--color-accent)]"
                        checked={got}
                        disabled={disabled}
                        onChange={() => toggle(i)}
                      />
                      <span className="flex-1 text-body">{r.point}</span>
                      <span className={`text-ui ${got ? "" : "text-text-muted"}`}>
                        {r.points} {r.points === 1 ? "pt" : "pts"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-ui text-text-muted" aria-live="polite">
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
