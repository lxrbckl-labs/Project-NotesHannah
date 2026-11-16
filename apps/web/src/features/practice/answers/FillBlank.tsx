import { Check, X } from "lucide-react";
import { Fragment, useRef } from "react";
import { FEEDBACK_HUE } from "../../../lib/roles";
import { keepVisibleOnFocus } from "../lib/hooks";
import type { ServedFillBlank } from "../types";
import { Inline } from "../ui/Markdown";
import type { AnswerProps } from "./shared";

type FillAnswer = { type: "fill_blank"; blanks: string[] };

export function FillBlank({
  question,
  value,
  onChange,
  disabled = false,
  result = null,
  onSubmitRequest,
}: AnswerProps<ServedFillBlank, FillAnswer>) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const n = question.blanks.length;
  const blanks = value?.blanks ?? Array<string>(n).fill("");
  const accepted = (result?.correctAnswer.data as FillAnswer | undefined)?.blanks ?? [];
  const pieces = question.text.split(/\{\{(\d+)\}\}/);

  const set = (i: number, text: string) => {
    const next = blanks.map((b, k) => (k === i ? text : b));
    onChange(next.some((b) => b.trim() !== "") ? { type: "fill_blank", blanks: next } : null);
  };

  return (
    <div className="space-y-4" data-testid="answer-fill_blank">
      <p className="text-reading leading-[2.7] md:text-title md:leading-[2.7]">
        {pieces.map((piece, k) => {
          if (k % 2 === 0)
            // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
            return <Inline key={k} text={piece} />;
          const i = Number(piece) - 1;
          const fb = result?.feedback[i];
          const hue = result
            ? fb?.correct
              ? FEEDBACK_HUE.correct
              : FEEDBACK_HUE.incorrect
            : undefined;
          const tone = result
            ? "border-tone-border bg-tone-soft text-tone-text"
            : "border-border-strong bg-surface focus:border-accent";
          const width = question.blanks[i]?.width ?? 8;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
            <Fragment key={k}>
              <input
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="text"
                value={blanks[i] ?? ""}
                disabled={disabled}
                readOnly={disabled}
                onChange={(e) => set(i, e.target.value)}
                onFocus={keepVisibleOnFocus}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  const next = refs.current[i + 1];
                  if (next) next.focus();
                  else onSubmitRequest?.();
                }}
                aria-label={`Blank ${i + 1} of ${n}`}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint={i < n - 1 ? "next" : "done"}
                data-testid={`blank-${i + 1}`}
                data-hue={hue}
                data-feedback={result ? (fb?.correct ? "correct" : "incorrect") : undefined}
                style={{ width: `${Math.max(6, width + 2)}ch` }}
                className={`mx-1 inline-block min-h-11 max-w-full rounded-control border px-3 py-1 text-center align-middle text-body outline-none transition-colors duration-(--duration-instant) ${tone}`}
              />
              {result && (
                <span
                  data-hue={hue}
                  className="mr-1 inline-flex items-center gap-1 align-middle text-ui font-medium text-tone-text"
                >
                  {fb?.correct ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
                  <span className="sr-only">{fb?.correct ? "Correct" : "Not correct"}</span>
                  {!fb?.correct && accepted[i] ? (
                    <span data-hue={FEEDBACK_HUE.correct}>({accepted[i]})</span>
                  ) : null}
                </span>
              )}
            </Fragment>
          );
        })}
      </p>
      {!disabled && (
        <p className="text-ui text-text-muted">Press Enter to move to the next blank.</p>
      )}
    </div>
  );
}
