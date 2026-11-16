import { practice } from "@notes/schema";
import { useState } from "react";
import { useFinePointer } from "../lib/hooks";
import type { ServedMatching } from "../types";
import { type AnswerProps, Prompt } from "./shared";

type MatchAnswer = { type: "matching"; matches: { pairId: string; right: string }[] };

const same = (a: string, b: string) => practice.normaliseLoose(a) === practice.normaliseLoose(b);

export function Matching({
  question,
  value,
  onChange,
  disabled = false,
  result = null,
}: AnswerProps<ServedMatching, MatchAnswer>) {
  const fine = useFinePointer();
  const matches = value?.matches ?? [];
  const chosen = (id: string) => matches.find((m) => m.pairId === id)?.right ?? null;
  const firstFree = question.lefts.find((l) => chosen(l.id) === null)?.id ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const active = disabled ? null : (picked ?? firstFree);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const correctMap = new Map(
    ((result?.correctAnswer.data as MatchAnswer | undefined)?.matches ?? []).map((m) => [
      m.pairId,
      m.right,
    ]),
  );

  const assign = (leftId: string, right: string) => {
    if (disabled) return;
    const next = [...matches.filter((m) => m.pairId !== leftId), { pairId: leftId, right }];
    // keep the lefts' order so the answer is stable
    next.sort(
      (a, b) =>
        question.lefts.findIndex((l) => l.id === a.pairId) -
        question.lefts.findIndex((l) => l.id === b.pairId),
    );
    onChange({ type: "matching", matches: next });
    const following = question.lefts.find(
      (l) => l.id !== leftId && !next.some((m) => m.pairId === l.id),
    );
    setPicked(following?.id ?? null);
  };
  const unpair = (leftId: string) => {
    if (disabled) return;
    const next = matches.filter((m) => m.pairId !== leftId);
    onChange(next.length ? { type: "matching", matches: next } : null);
    setPicked(leftId);
  };
  const linkOf = (leftId: string) => question.lefts.findIndex((l) => l.id === leftId) + 1;
  const colour = (n: number) => `var(--pr-link-${((n - 1) % 6) + 1})`;

  return (
    <fieldset className="space-y-4" data-testid="answer-matching">
      <legend className="mb-3 w-full">
        <Prompt text={question.prompt} />
      </legend>
      {!disabled && (
        <p className="text-sm text-text-muted" id="match-help">
          {fine
            ? "Pick an item, then its match, or drag a match onto an item."
            : "Tap an item, then tap its match. Tap the cross to undo a match."}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2 md:gap-8">
        <div className="space-y-2.5">
          <p aria-hidden className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Items
          </p>
          <ul className="space-y-2.5" aria-label="Items to match">
            {question.lefts.map((l) => {
              const right = chosen(l.id);
              const isActive = active === l.id;
              const good =
                result && right !== null ? same(right, correctMap.get(l.id) ?? "") : null;
              const tone = result
                ? good
                  ? "pr-ok"
                  : "pr-bad"
                : isActive
                  ? "border-accent bg-[var(--pr-accent-soft)]"
                  : "border-border bg-surface";
              return (
                <li
                  key={l.id}
                  data-testid={`left-${l.id}`}
                  data-active={isActive}
                  onDragOver={(e) => {
                    if (disabled) return;
                    e.preventDefault();
                    setDragOver(l.id);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === l.id ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const text = e.dataTransfer.getData("text/plain");
                    if (text) assign(l.id, text);
                  }}
                  className={`flex items-stretch overflow-hidden rounded-2xl border transition-colors ${tone} ${
                    dragOver === l.id ? "ring-2 ring-accent" : ""
                  }`}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={isActive}
                    onClick={() => setPicked(l.id)}
                    className="flex min-h-16 flex-1 items-center gap-3 px-3.5 py-2.5 text-left disabled:cursor-default"
                  >
                    <span
                      aria-hidden
                      className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold"
                      style={{ background: colour(linkOf(l.id)), color: "var(--pr-link-ink)" }}
                    >
                      {linkOf(l.id)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[1rem] font-medium">{l.text}</span>
                      <span
                        className={`mt-0.5 block text-sm ${right ? "" : "text-text-muted"}`}
                        data-testid={`match-${l.id}`}
                      >
                        {right ? `→ ${right}` : isActive ? "Choose a match" : "No match yet"}
                      </span>
                      {result && good === false && (
                        <span className="mt-0.5 block text-sm font-medium">
                          Correct: {correctMap.get(l.id)}
                        </span>
                      )}
                    </span>
                    {result && (
                      <span aria-hidden className="text-lg">
                        {good ? "✓" : "✗"}
                      </span>
                    )}
                    {result && <span className="sr-only">{good ? "Correct" : "Not correct"}</span>}
                  </button>
                  {right !== null && !disabled && (
                    <button
                      type="button"
                      onClick={() => unpair(l.id)}
                      aria-label={`Remove match for ${l.text}`}
                      className="grid w-12 place-items-center border-l border-border text-text-muted hover:bg-surface-muted hover:text-text"
                    >
                      <span aria-hidden>✕</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="space-y-2.5">
          <p aria-hidden className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Matches
          </p>
          <ul className="space-y-2.5" aria-label="Matches to choose from">
            {question.rights.map((r) => {
              const users = question.lefts.filter((l) => chosen(l.id) === r);
              return (
                <li key={r}>
                  <button
                    type="button"
                    disabled={disabled}
                    draggable={fine && !disabled}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", r);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => active && assign(active, r)}
                    className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-left text-[1rem] transition-colors enabled:hover:bg-surface-muted ${
                      fine && !disabled ? "cursor-grab" : ""
                    }`}
                  >
                    <span>{r}</span>
                    <span className="flex gap-1" aria-hidden>
                      {users.map((u) => (
                        <span
                          key={u.id}
                          className="grid size-6 place-items-center rounded-full text-xs font-bold"
                          style={{ background: colour(linkOf(u.id)), color: "var(--pr-link-ink)" }}
                        >
                          {linkOf(u.id)}
                        </span>
                      ))}
                    </span>
                    {users.length > 0 && (
                      <span className="sr-only">
                        Chosen for {users.map((u) => u.text).join(", ")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </fieldset>
  );
}
