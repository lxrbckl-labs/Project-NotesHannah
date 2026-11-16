import { Check, X } from "lucide-react";
import { useState } from "react";
import { Chip } from "../../../components/ui/badge";
import { Disclosure } from "../../../components/ui/disclosure";
import { FEEDBACK_HUE } from "../../../lib/roles";
import { keepVisibleOnFocus } from "../lib/hooks";
import type { Rounding, ServedCalculation } from "../types";
import { type AnswerProps, Prompt } from "./shared";

type CalcAnswer = { type: "calculation"; response: string; unit?: string };

export function roundingNote(r: Rounding | undefined): string | null {
  if (!r) return null;
  return r.mode === "decimals"
    ? `Round to ${r.places} decimal ${r.places === 1 ? "place" : "places"}.`
    : `Give ${r.figures} significant ${r.figures === 1 ? "figure" : "figures"}.`;
}

export function Calculation({
  question,
  value,
  onChange,
  disabled = false,
  result = null,
  onSubmitRequest,
}: AnswerProps<ServedCalculation, CalcAnswer>) {
  const response = value?.response ?? "";
  const unit = value?.unit ?? "";
  const [scratch, setScratch] = useState("");
  const note = roundingNote(question.rounding);
  const update = (patch: Partial<{ response: string; unit: string }>) => {
    const next = { response, unit, ...patch };
    onChange(
      next.response.trim() === "" && next.unit.trim() === ""
        ? null
        : {
            type: "calculation",
            response: next.response,
            ...(next.unit.trim() ? { unit: next.unit.trim() } : {}),
          },
    );
  };
  const fb = result?.feedback[0];
  const hue = result ? (result.correct ? FEEDBACK_HUE.correct : FEEDBACK_HUE.incorrect) : undefined;
  const tone = result
    ? "border-tone-border bg-tone-soft text-tone-text"
    : "border-border-strong bg-surface";
  const field =
    "min-h-13 w-full rounded-card border px-4 text-title outline-none transition-colors duration-(--duration-instant) focus:border-accent";
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmitRequest?.();
    }
  };
  return (
    <div className="space-y-5" data-testid="answer-calculation">
      <Prompt text={question.prompt} emphasiseNumbers />
      {note && (
        <p className="text-ui text-text-muted" data-testid="rounding-note">
          {note}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="calc-value" className="mb-1.5 block text-ui font-medium text-text-muted">
            Your answer
          </label>
          <input
            id="calc-value"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            value={response}
            disabled={disabled}
            onChange={(e) => update({ response: e.target.value })}
            onFocus={keepVisibleOnFocus}
            onKeyDown={onKey}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 2.5"
            data-testid="calc-value"
            data-hue={hue}
            data-feedback={result ? (result.correct ? "correct" : "incorrect") : undefined}
            className={`${field} tabular-nums ${tone}`}
          />
        </div>
        <div className="sm:w-44">
          <label htmlFor="calc-unit" className="mb-1.5 block text-ui font-medium text-text-muted">
            Unit
          </label>
          <input
            id="calc-unit"
            type="text"
            list="calc-units"
            enterKeyHint="done"
            value={unit}
            disabled={disabled}
            onChange={(e) => update({ unit: e.target.value })}
            onFocus={keepVisibleOnFocus}
            onKeyDown={onKey}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. mg"
            data-testid="calc-unit"
            data-hue={hue}
            data-feedback={result ? (result.correct ? "correct" : "incorrect") : undefined}
            className={`${field} ${tone}`}
          />
          <datalist id="calc-units">
            {question.unitChoices.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
      </div>
      {!disabled && (
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Unit choices</legend>
          {question.unitChoices.map((u) => (
            <Chip
              key={u}
              pressed={unit.trim().toLowerCase() === u.toLowerCase()}
              onClick={() => update({ unit: unit.trim() === u ? "" : u })}
              className="min-w-11 justify-center"
            >
              {u}
            </Chip>
          ))}
        </fieldset>
      )}
      {result && fb && (
        <p
          className={`flex items-start gap-2 rounded-card border px-4 py-3 text-body ${tone}`}
          data-testid="calc-feedback"
          data-hue={hue}
          data-feedback={result.correct ? "correct" : "incorrect"}
        >
          <span aria-hidden className="mt-0.5 shrink-0">
            {result.correct ? <Check size={18} /> : <X size={18} />}
          </span>
          <span>{fb.message}</span>
        </p>
      )}
      <Disclosure label="Scratchpad (not marked)">
        <textarea
          value={scratch}
          onChange={(e) => setScratch(e.target.value)}
          onFocus={keepVisibleOnFocus}
          aria-label="Scratchpad"
          rows={4}
          spellCheck={false}
          placeholder="Work it out here"
          className="mt-1 w-full rounded-card border border-border-strong bg-surface p-3 font-mono text-ui outline-none focus:border-accent"
        />
      </Disclosure>
    </div>
  );
}
