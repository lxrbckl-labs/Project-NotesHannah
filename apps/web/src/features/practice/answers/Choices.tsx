import { Check, X } from "lucide-react";
import { FEEDBACK_HUE } from "../../../lib/roles";
import type { ServedMultipleChoice, ServedSelectAll } from "../types";
import { type AnswerProps, LETTERS, Prompt, useOptionShortcuts } from "./shared";

type OptionState = "idle" | "correct" | "wrong" | "missed";

function ChoiceRow({
  name,
  index,
  text,
  multi,
  checked,
  disabled,
  state,
  onToggle,
}: {
  name: string;
  index: number;
  text: string;
  multi: boolean;
  checked: boolean;
  disabled: boolean;
  state: OptionState;
  onToggle: () => void;
}) {
  const hue =
    state === "correct"
      ? FEEDBACK_HUE.correct
      : state === "wrong"
        ? FEEDBACK_HUE.incorrect
        : state === "missed"
          ? FEEDBACK_HUE.partial
          : undefined;
  const tone = hue
    ? "border-tone-border bg-tone-soft text-tone-text"
    : checked
      ? "border-accent bg-accent-soft"
      : "border-border bg-surface hover:bg-surface-muted";
  // The words that go with the colour: visible, and read by screen readers.
  const status =
    state === "correct"
      ? checked || !multi
        ? "Correct answer"
        : "Correct answer you did not pick"
      : state === "wrong"
        ? "Your pick, not correct"
        : state === "missed"
          ? "Correct answer you missed"
          : "";
  return (
    <label
      className={`relative flex min-h-14 cursor-pointer items-center gap-3 rounded-card border px-3.5 py-3 transition-colors duration-(--duration-instant) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${tone} ${disabled ? "cursor-default" : ""}`}
      data-state={state}
      data-checked={checked}
      data-hue={hue}
      data-feedback={
        state === "correct"
          ? "correct"
          : state === "wrong"
            ? "incorrect"
            : state === "missed"
              ? "partial"
              : undefined
      }
    >
      <input
        type={multi ? "checkbox" : "radio"}
        name={name}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span
        aria-hidden
        className={`grid size-8 shrink-0 place-items-center border text-ui font-semibold ${multi ? "rounded-control" : "rounded-pill"} ${
          hue
            ? "border-tone-solid bg-surface"
            : checked
              ? "border-accent bg-accent text-accent-contrast"
              : "border-border-strong text-text-muted"
        }`}
      >
        {state === "correct" || state === "missed" ? (
          <Check size={16} />
        ) : state === "wrong" ? (
          <X size={16} />
        ) : (
          (LETTERS[index] ?? index + 1)
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body leading-snug">{text}</span>
        {status && <span className="mt-0.5 block text-caption font-medium">{status}</span>}
      </span>
    </label>
  );
}

export function MultipleChoice({
  question,
  value,
  onChange,
  disabled = false,
  result = null,
}: AnswerProps<ServedMultipleChoice, { type: "multiple_choice"; optionId: string }>) {
  const correctId = (result?.correctAnswer.data as { optionId?: string } | undefined)?.optionId;
  const pick = (i: number) => {
    const o = question.options[i];
    if (o && !disabled) onChange({ type: "multiple_choice", optionId: o.id });
  };
  useOptionShortcuts(question.options.length, !disabled, pick);
  const name = `mc-${question.options.map((o) => o.id).join("")}`;
  return (
    <fieldset className="space-y-4" data-testid="answer-multiple_choice">
      <legend className="mb-4 w-full">
        <Prompt text={question.prompt} />
      </legend>
      <div className="space-y-3">
        {question.options.map((o, i) => (
          <ChoiceRow
            key={o.id}
            name={name}
            index={i}
            text={o.text}
            multi={false}
            checked={value?.optionId === o.id}
            disabled={disabled}
            state={
              result
                ? o.id === correctId
                  ? "correct"
                  : value?.optionId === o.id
                    ? "wrong"
                    : "idle"
                : "idle"
            }
            onToggle={() => pick(i)}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function SelectAll({
  question,
  value,
  onChange,
  disabled = false,
  result = null,
}: AnswerProps<ServedSelectAll, { type: "select_all"; optionIds: string[] }>) {
  const picked = value?.optionIds ?? [];
  const correctIds = new Set(
    (result?.correctAnswer.data as { optionIds?: string[] } | undefined)?.optionIds ?? [],
  );
  const toggle = (i: number) => {
    const o = question.options[i];
    if (!o || disabled) return;
    const next = picked.includes(o.id) ? picked.filter((id) => id !== o.id) : [...picked, o.id];
    onChange(next.length ? { type: "select_all", optionIds: next } : null);
  };
  useOptionShortcuts(question.options.length, !disabled, toggle);
  const name = `sa-${question.options.map((o) => o.id).join("")}`;
  return (
    <fieldset className="space-y-4" data-testid="answer-select_all">
      <legend className="mb-4 w-full">
        <Prompt text={question.prompt} />
      </legend>
      <p className="text-ui text-text-muted">Select all that apply.</p>
      <div className="space-y-3">
        {question.options.map((o, i) => {
          const isPicked = picked.includes(o.id);
          const isRight = correctIds.has(o.id);
          const state: OptionState = !result
            ? "idle"
            : isRight
              ? isPicked
                ? "correct"
                : "missed"
              : isPicked
                ? "wrong"
                : "idle";
          return (
            <ChoiceRow
              key={o.id}
              name={name}
              index={i}
              text={o.text}
              multi
              checked={isPicked}
              disabled={disabled}
              state={state}
              onToggle={() => toggle(i)}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
