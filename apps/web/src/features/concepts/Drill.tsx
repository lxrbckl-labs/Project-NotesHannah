import type { BrandGenericPair } from "@notes/schema";
import { Check, CircleCheck, CircleX, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { FEEDBACK_HUE } from "../../lib/roles";
import {
  answerDone,
  attempt,
  DRILL_MODES,
  type DrillMode,
  isFinished,
  itemsFor,
  missedItems,
  pickRound,
  type Rng,
  ROUND_SIZE,
  type Round,
  score,
  startRound,
} from "./model/drill";
import { useConcepts } from "./ui/context";
import { useAsync } from "./ui/hooks";
import { Card } from "./ui/parts";

/** Brand and generic drill (G12): tap a prompt, tap its partner, get an answer at once. */
export function Drill({ rng }: { rng?: Rng }) {
  const { store } = useConcepts();
  const pairs = useAsync(() => store.brandGeneric(), "pairs");
  if (pairs.status === "loading") return <LoadingList rows={3} label="Loading the drill" />;
  if (pairs.status === "error") return <ErrorState error={pairs.error} onRetry={pairs.reload} />;
  if (pairs.data.length === 0)
    return (
      <EmptyState icon={<Check size={26} />} title="Nothing to drill yet">
        Brand names show up here once drugs in your notes have them filed.
      </EmptyState>
    );
  return <DrillGame pairs={pairs.data} rng={rng} />;
}

type Phase =
  | { name: "menu" }
  | { name: "play"; mode: DrillMode; round: Round; again: boolean }
  | { name: "done"; mode: DrillMode; round: Round };

function DrillGame({ pairs, rng }: { pairs: BrandGenericPair[]; rng?: Rng }) {
  const [phase, setPhase] = useState<Phase>({ name: "menu" });
  const [mode, setMode] = useState<DrillMode>("brand_to_generic");
  const available = useMemo(
    () =>
      Object.fromEntries(
        DRILL_MODES.map((m) => [m.mode, itemsFor(pairs, m.mode).length]),
      ) as Record<DrillMode, number>,
    [pairs],
  );
  const rand = rng ?? Math.random;

  const start = (m: DrillMode) => {
    const items = pickRound(itemsFor(pairs, m), ROUND_SIZE, rand);
    setPhase({ name: "play", mode: m, round: startRound(items, rand), again: false });
  };

  if (phase.name === "menu")
    return (
      <Card className="grid gap-4">
        <div>
          <h2 className="font-display text-title font-semibold">Brand and generic drill</h2>
          <p className="mt-1 text-ui text-text-muted">
            A short round of {ROUND_SIZE}. Tap a name on the left, then its partner on the right.
          </p>
        </div>
        <div role="radiogroup" aria-label="Kind of round" className="grid gap-2 md:grid-cols-3">
          {DRILL_MODES.map((m) => {
            const disabled = available[m.mode] < 2;
            const on = mode === m.mode;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a radio styled as a card
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                data-testid={`mode-${m.mode}`}
                onClick={() => setMode(m.mode)}
                className={cn(
                  "min-h-14 rounded-card border px-4 py-3 text-left transition-colors duration-(--duration-instant) disabled:opacity-50",
                  on
                    ? "border-accent bg-accent-soft"
                    : "border-border bg-bg hover:border-border-strong",
                )}
              >
                <span className={cn("block text-ui font-semibold", on && "text-accent")}>
                  {m.label}
                </span>
                <span className="mt-0.5 block text-caption text-text-muted">{m.hint}</span>
              </button>
            );
          })}
        </div>
        <div>
          <Button
            variant="primary"
            data-testid="start-round"
            onClick={() => start(mode)}
            disabled={available[mode] < 2}
          >
            Start a round
          </Button>
        </div>
      </Card>
    );

  if (phase.name === "done") {
    const { firstTry, total } = score(phase.round);
    const missed = missedItems(phase.round);
    return (
      <Card className="grid gap-4">
        <div data-testid="drill-results">
          <h2 className="font-display text-title font-semibold">
            {firstTry} of {total} right on the first try
          </h2>
          <p className="mt-1 text-ui text-text-muted">
            {missed.length === 0
              ? "Every pair was right straight away."
              : "These ones need another look."}
          </p>
        </div>
        {missed.length > 0 ? (
          <ul className="grid gap-1.5" data-testid="missed-list">
            {missed.map((i) => (
              <li
                key={i.id}
                className="rounded-card border border-border bg-bg px-3.5 py-2.5 text-ui"
              >
                <span className="font-medium">{i.prompt}</span>{" "}
                <span className="text-text-muted">goes with</span>{" "}
                <span className="font-medium">{i.answer}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {missed.length > 0 ? (
            <Button
              variant="primary"
              data-testid="missed-again"
              onClick={() =>
                setPhase({
                  name: "play",
                  mode: phase.mode,
                  round: startRound(missed, rand),
                  again: true,
                })
              }
            >
              <RotateCcw size={16} aria-hidden /> Missed ones again
            </Button>
          ) : null}
          <Button
            variant={missed.length > 0 ? "secondary" : "primary"}
            onClick={() => start(phase.mode)}
          >
            New round
          </Button>
          <Button variant="ghost" onClick={() => setPhase({ name: "menu" })}>
            Change kind
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Board
      key={`${phase.mode}:${phase.round.items.map((i) => i.id).join()}`}
      mode={phase.mode}
      initial={phase.round}
      again={phase.again}
      onFinish={(round) => setPhase({ name: "done", mode: phase.mode, round })}
      onQuit={() => setPhase({ name: "menu" })}
    />
  );
}

function Board({
  mode,
  initial,
  again,
  onFinish,
  onQuit,
}: {
  mode: DrillMode;
  initial: Round;
  again: boolean;
  onFinish: (round: Round) => void;
  onQuit: () => void;
}) {
  const [round, setRound] = useState(initial);
  const [pickedPrompt, setPickedPrompt] = useState<string | null>(null);
  const [pickedAnswer, setPickedAnswer] = useState<string | null>(null);
  const [wrong, setWrong] = useState<{ prompt: string; answer: string } | null>(null);
  const [message, setMessage] = useState("Pick a name on the left.");
  const [verdict, setVerdict] = useState<"correct" | "incorrect" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const settle = (promptId: string, answer: string) => {
    const item = round.items.find((i) => i.id === promptId);
    const result = attempt(round, promptId, answer);
    setRound(result.round);
    setPickedPrompt(null);
    setPickedAnswer(null);
    if (result.correct && item) {
      setMessage(`Correct: ${item.prompt} goes with ${item.answer}.`);
      setVerdict("correct");
      setWrong(null);
      if (isFinished(result.round)) timer.current = setTimeout(() => onFinish(result.round), 700);
    } else if (item) {
      setMessage("Not quite. Try another pair.");
      setVerdict("incorrect");
      setWrong({ prompt: promptId, answer });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setWrong(null), 700);
    }
  };

  const tapPrompt = (id: string) => {
    if (round.matched.includes(id)) return;
    if (pickedAnswer) return settle(id, pickedAnswer);
    setPickedPrompt(pickedPrompt === id ? null : id);
    setVerdict(null);
    setMessage("Now pick its partner on the right.");
  };
  const tapAnswer = (answer: string) => {
    if (answerDone(round, answer)) return;
    if (pickedPrompt) return settle(pickedPrompt, answer);
    setPickedAnswer(pickedAnswer === answer ? null : answer);
    setVerdict(null);
    setMessage("Now pick the name it goes with on the left.");
  };

  const done = round.matched.length;
  return (
    <Card className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-title font-semibold">
            {again ? "Missed ones again" : DRILL_MODES.find((m) => m.mode === mode)?.label}
          </h2>
          <p className="text-ui text-text-muted" data-testid="drill-progress">
            {done} of {round.items.length} matched
          </p>
        </div>
        <Button variant="ghost" onClick={onQuit}>
          Stop
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        data-hue={verdict ? FEEDBACK_HUE[verdict] : undefined}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-control px-3 text-ui font-medium",
          verdict ? "bg-tone-soft text-tone-text" : "text-text",
        )}
        data-testid="drill-message"
      >
        {verdict === "correct" ? <CircleCheck size={18} aria-hidden className="shrink-0" /> : null}
        {verdict === "incorrect" ? <CircleX size={18} aria-hidden className="shrink-0" /> : null}
        <span>{message}</span>
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0 md:gap-x-6" data-testid="drill-board">
        <ul className="grid content-start gap-2" aria-label="Names">
          {round.items.map((item) => {
            const state = round.matched.includes(item.id)
              ? "matched"
              : wrong?.prompt === item.id
                ? "wrong"
                : pickedPrompt === item.id
                  ? "selected"
                  : "idle";
            return (
              <li key={item.id}>
                <Tile state={state} testid="drill-prompt" onClick={() => tapPrompt(item.id)}>
                  {item.prompt}
                </Tile>
              </li>
            );
          })}
        </ul>
        <ul className="grid content-start gap-2" aria-label="Partners">
          {round.answers.map((answer) => {
            const state = answerDone(round, answer)
              ? "matched"
              : wrong?.answer === answer
                ? "wrong"
                : pickedAnswer === answer
                  ? "selected"
                  : "idle";
            return (
              <li key={answer}>
                <Tile state={state} testid="drill-answer" onClick={() => tapAnswer(answer)}>
                  {answer}
                </Tile>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

function Tile({
  state,
  testid,
  onClick,
  children,
}: {
  state: "idle" | "selected" | "matched" | "wrong";
  testid: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-state={state}
      aria-pressed={state === "selected"}
      aria-disabled={state === "matched"}
      onClick={onClick}
      data-hue={
        state === "matched"
          ? FEEDBACK_HUE.correct
          : state === "wrong"
            ? FEEDBACK_HUE.incorrect
            : undefined
      }
      className={cn(
        "flex min-h-14 w-full items-center justify-between gap-2 rounded-card border px-3 py-2 text-left text-body font-medium leading-snug transition-colors duration-(--duration-instant)",
        state === "idle" && "border-border bg-bg hover:border-border-strong",
        state === "selected" && "border-accent bg-accent-soft text-accent",
        state === "matched" && "border-tone-border bg-tone-soft text-tone-text",
        state === "wrong" && "cx-nudge border-tone-border bg-tone-soft text-tone-text",
      )}
    >
      <span className="min-w-0 break-words">{children}</span>
      {state === "matched" ? <Check size={18} aria-label="matched" className="shrink-0" /> : null}
      {state === "wrong" ? <X size={18} aria-label="not a match" className="shrink-0" /> : null}
    </button>
  );
}
