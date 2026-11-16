import { Collapsible } from "radix-ui";
import { useState } from "react";
import type { GradeResult, QuestionOutcome, Reveal, ServedCase } from "../types";
import { FeedbackLines, verdict } from "../ui/Feedback";
import { Markdown } from "../ui/Markdown";
import { Button, Chip } from "../ui/primitives";
import { isPartReady, type PartDraft, PartView } from "./Part";

/** Draft for a case: one slot per sub-question; undefined = not visited yet, null = skipped. */
export interface CaseDraft {
  type: "case";
  parts: (PartDraft | null | undefined)[];
}

export function isCaseReady(question: ServedCase, value: CaseDraft | null): boolean {
  if (!value) return false;
  return question.parts.every((_, i) => value.parts[i] !== undefined);
}

export function Case({
  question,
  value,
  onChange,
  disabled = false,
  result = null,
  partExplanations,
  reveal,
  onSubmitRequest,
}: {
  question: ServedCase;
  value: CaseDraft | null;
  onChange: (draft: CaseDraft) => void;
  disabled?: boolean;
  result?: GradeResult | null;
  partExplanations?: string[] | undefined;
  reveal?: (partIndex: number) => Promise<Reveal>;
  onSubmitRequest?: () => void;
}) {
  const n = question.parts.length;
  const parts = value?.parts ?? Array<undefined>(n).fill(undefined);
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(true);
  const setPart = (i: number, a: PartDraft | null) =>
    onChange({ type: "case", parts: parts.map((p, k) => (k === i ? a : p)) });
  const part = question.parts[step];
  const cur = parts[step];
  const resolved = cur !== undefined;

  const vignette = (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="pr-card overflow-hidden md:static"
      data-testid="vignette"
    >
      <Collapsible.Trigger className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-sm font-semibold text-text-muted md:pointer-events-none">
        <span>Patient case</span>
        <span aria-hidden className="md:hidden">
          {open ? "Hide" : "Show"}
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="max-h-[38vh] overflow-y-auto px-4 pb-4 text-[0.97rem] leading-relaxed md:max-h-none">
        <Markdown text={question.vignette} />
      </Collapsible.Content>
    </Collapsible.Root>
  );

  return (
    <div
      className="grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start md:gap-8"
      data-testid="answer-case"
    >
      <div className="sticky top-0 z-10 -mx-1 bg-bg px-1 pb-2 pt-1 md:top-4 md:z-0 md:bg-transparent md:p-0">
        {vignette}
      </div>
      <div className="space-y-5">
        {!result ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-text-muted" data-testid="case-step">
                Part {step + 1} of {n}
              </h2>
              <div className="flex gap-1.5" aria-hidden>
                {question.parts.map((p, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts are addressed by position
                    key={`${p.type}-${i}`}
                    className={`h-1.5 w-6 rounded-full ${
                      i === step
                        ? "bg-accent"
                        : parts[i] !== undefined
                          ? "bg-accent/40"
                          : "bg-surface-muted"
                    }`}
                  />
                ))}
              </div>
            </div>
            {part && (
              <PartView
                key={step}
                question={part}
                mode="part"
                value={cur ?? null}
                disabled={disabled}
                onChange={(a) => setPart(step, a)}
                {...(reveal ? { reveal: () => reveal(step) } : {})}
                onSubmitRequest={() => (step < n - 1 ? undefined : onSubmitRequest?.())}
              />
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button variant="quiet" disabled={step === 0} onClick={() => setStep(step - 1)}>
                Previous part
              </Button>
              {part && !isPartReady(part, cur ?? null) && (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setPart(step, null);
                    if (step < n - 1) setStep(step + 1);
                  }}
                >
                  Skip this part
                </Button>
              )}
              {step < n - 1 && (
                <Button
                  variant="secondary"
                  className="ml-auto"
                  data-testid="next-part"
                  disabled={!resolved && !(part && isPartReady(part, cur ?? null))}
                  onClick={() => {
                    if (!resolved) setPart(step, cur ?? null);
                    setStep(step + 1);
                  }}
                >
                  Next part
                </Button>
              )}
              {step === n - 1 && !resolved && part && isPartReady(part, cur ?? null) && (
                <Button
                  variant="secondary"
                  className="ml-auto"
                  data-testid="done-part"
                  onClick={() => setPart(step, cur ?? null)}
                >
                  Done with this part
                </Button>
              )}
            </div>
          </>
        ) : (
          <ol className="space-y-6" data-testid="case-review">
            {question.parts.map((p, i) => {
              const r = result.parts?.[i] ?? null;
              const v = r ? verdict(r) : null;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts are addressed by position
                <li key={`${p.type}-${i}`} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text-muted">
                      Part {i + 1} of {n}
                    </h3>
                    {v && <Chip tone={v.tone}>{v.title}</Chip>}
                  </div>
                  <PartView
                    question={p}
                    mode="part"
                    value={(parts[i] as PartDraft | null | undefined) ?? null}
                    disabled
                    result={r}
                    onChange={() => undefined}
                    {...(reveal ? { reveal: () => reveal(i) } : {})}
                  />
                  {r &&
                    p.type !== "flashcard" &&
                    p.type !== "free_response" &&
                    p.type !== "calculation" && <FeedbackLines result={r} />}
                  {r && !r.correct && p.type === "calculation" && (
                    <p className="text-[0.95rem]">
                      <span className="font-medium">Correct answer: </span>
                      {r.correctAnswer.text}
                    </p>
                  )}
                  {partExplanations?.[i] && (
                    <div className="rounded-2xl bg-surface-muted p-3.5 text-[0.93rem]">
                      <Markdown text={partExplanations[i] as string} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

export type { QuestionOutcome };
