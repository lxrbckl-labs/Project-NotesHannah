import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { ProgressBar } from "../../../components/ui/progress";
import { LiveRegion, Spinner } from "../../../components/ui/states";
import { AnswerFor, type Draft, isReady, SELF_SUBMITTING, toAnswer } from "../answers";
import { useActiveTimer, useVisibleHeight } from "../lib/hooks";
import type {
  Answer,
  PracticeStore,
  QuestionOutcome,
  SessionResults,
  SessionState,
  SourceCitation,
} from "../types";
import { PracticeApiError, TYPE_LABELS } from "../types";
import { announcement, FeedbackPanel } from "../ui/Feedback";
import { QUIET } from "../ui/quiet";

export interface PlayerProps {
  store: PracticeStore;
  sessionId: string;
  /** Called when she leaves with the session still open (it can be resumed). */
  onExit: () => void;
  onFinished: (results: SessionResults) => void;
  onOpenSource?: (citation: SourceCitation) => void;
  onAskQuestion?: ((questionId: string) => void) | undefined;
  /** True while a session is on screen, so the shell can guard its own navigation. */
  onActiveChange?: (active: boolean) => void;
}

type Phase = "loading" | "answering" | "feedback" | "finishing";

export function Player({
  store,
  sessionId,
  onExit,
  onFinished,
  onOpenSource,
  onAskQuestion,
  onActiveChange,
}: PlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLElement>(null);
  useVisibleHeight(rootRef);

  // The parent may pass new function props on every render; keep the latest without re-running effects.
  const cb = useRef({ onFinished, onActiveChange });
  cb.current = { onFinished, onActiveChange };

  const [session, setSession] = useState<SessionState | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [outcome, setOutcome] = useState<QuestionOutcome | null>(null);
  const [paused, setPaused] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const current = session?.current ?? null;
  const elapsed = useActiveTimer(
    current ? `${sessionId}:${current.index}` : "none",
    paused || phase !== "answering",
  );

  const finish = useCallback(async () => {
    setPhase("finishing");
    try {
      cb.current.onFinished(await store.finishSession(sessionId));
    } catch (e) {
      setError(messageOf(e));
      setPhase("answering");
    }
  }, [sessionId, store]);

  const enter = useCallback(
    (s: SessionState) => {
      setSession(s);
      setDraft(null);
      setOutcome(null);
      setError(null);
      if (!s.current || s.status === "finished") {
        void finish();
        return;
      }
      setPhase("answering");
      window.setTimeout(() => mainRef.current?.focus({ preventScroll: true }), 0);
    },
    [finish],
  );

  useEffect(() => {
    let live = true;
    store.getSession(sessionId).then(
      (s) => live && enter(s),
      (e) => live && setError(messageOf(e)),
    );
    return () => {
      live = false;
    };
  }, [store, sessionId, enter]);

  useEffect(() => {
    cb.current.onActiveChange?.(true);
    return () => cb.current.onActiveChange?.(false);
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const submit = useCallback(
    async (override?: Answer) => {
      if (!current || busy || phase !== "answering") return;
      const answer =
        override ?? (draft && isReady(current, draft) ? toAnswer(current, draft) : null);
      if (!answer) return;
      setBusy(true);
      setError(null);
      try {
        const out = await store.submitAnswer(sessionId, current.index, answer, elapsed());
        setOutcome(out);
        setPhase("feedback");
        setMessage(announcement(out, current.type));
        setSession((s) =>
          s
            ? {
                ...s,
                answered: s.answered + 1,
                items: s.items.map((it) =>
                  it.index === current.index ? { ...it, status: "answered" } : it,
                ),
              }
            : s,
        );
        window.setTimeout(() => feedbackRef.current?.focus(), 30);
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, current, draft, elapsed, phase, sessionId, store],
  );

  const next = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      enter(await store.getSession(sessionId));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [busy, enter, sessionId, store]);

  const skip = useCallback(async () => {
    if (!current || busy || phase !== "answering") return;
    setBusy(true);
    try {
      enter(await store.skip(sessionId, current.index));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [busy, current, enter, phase, sessionId, store]);

  const leave = useCallback(() => {
    onExit();
  }, [onExit]);

  // Enter continues; Escape pauses. Buttons and fields keep their own Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"]') || paused) {
        if (paused && e.key === "Escape") setPaused(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (e.key === "Escape") {
        if (tag !== "TEXTAREA" && tag !== "INPUT") setPaused(true);
        return;
      }
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.isComposing) return;
      const choice =
        tag === "INPUT" && ["radio", "checkbox"].includes((t as HTMLInputElement).type);
      if (
        !choice &&
        (tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "BUTTON" ||
          tag === "A" ||
          tag === "SELECT")
      )
        return;
      if (phase === "feedback") {
        e.preventDefault();
        void next();
      } else if (phase === "answering" && current && !SELF_SUBMITTING.has(current.type)) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, next, paused, phase, submit]);

  if (!session && error) {
    return (
      <Shell rootRef={rootRef}>
        <div className="mx-auto w-full max-w-xl p-6">
          <Notice tone="danger">{error}</Notice>
          <Button className="mt-4" onClick={onExit}>
            Back
          </Button>
        </div>
      </Shell>
    );
  }
  if (!session || !current) {
    return (
      <Shell rootRef={rootRef}>
        <Spinner label={phase === "finishing" ? "Finishing up" : "Loading your session"} />
      </Shell>
    );
  }

  const selfSubmitting = SELF_SUBMITTING.has(current.type);
  const moreAfter = session.items.some((it) => it.status !== "answered");
  const wide = current.type === "case" || current.type === "matching";
  const ready = isReady(current, draft);
  const position = current.index + 1;

  return (
    <Shell rootRef={rootRef}>
      <header className="shrink-0 border-b border-border bg-bg px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2">
          <IconButton
            label="Leave this session"
            data-testid="leave"
            onClick={() => setLeaveOpen(true)}
            className="-ml-1"
          >
            <X size={20} />
          </IconButton>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-ui font-semibold" data-testid="position">
              Question {position} of {session.total}
            </p>
            <p className="truncate text-caption text-text-muted">{session.scopeLabel}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={QUIET}
            data-testid="pause"
            onClick={() => setPaused(true)}
          >
            Pause
          </Button>
          {session.answered > 0 && moreAfter && (
            <Button
              variant="ghost"
              size="sm"
              className={`hidden sm:inline-flex ${QUIET}`}
              onClick={() => setFinishOpen(true)}
            >
              Finish
            </Button>
          )}
        </div>
        <div className="mx-auto mt-2 w-full max-w-5xl">
          <ProgressBar
            size="sm"
            value={session.answered}
            max={session.total}
            label={`${session.answered} of ${session.total} answered`}
          />
        </div>
      </header>

      <div
        ref={mainRef}
        tabIndex={-1}
        className="pr-scroll relative min-h-0 flex-1 overflow-y-auto outline-none"
        data-testid="player-main"
      >
        <div
          className={`mx-auto w-full px-4 pb-10 pt-6 md:px-6 md:pt-10 ${wide ? "max-w-5xl" : "max-w-2xl"}`}
          aria-hidden={paused}
          inert={paused}
          data-testid="player"
          data-session={sessionId}
          data-qtype={current.type}
          data-question-id={current.questionId}
          data-index={current.index}
          data-phase={phase}
        >
          <div className="mb-5 flex flex-wrap items-center gap-2 text-label text-text-muted">
            <span className="font-semibold uppercase tracking-wide">
              {TYPE_LABELS[current.type]}
            </span>
            {current.index > 0 && session.skipped > 0 && null}
          </div>
          <AnswerFor
            question={current}
            draft={draft}
            onChange={setDraft}
            disabled={phase !== "answering" || busy}
            result={outcome?.result ?? null}
            partExplanations={outcome?.partExplanations}
            reveal={(partIndex) => store.reveal(sessionId, current.index, partIndex)}
            onCommit={(a) => void submit(a)}
            onSubmitRequest={() => void submit()}
          />
          {error && (
            <Notice tone="danger" className="mt-5">
              {error}
            </Notice>
          )}
          {outcome && (
            <div className="mt-8">
              <FeedbackPanel
                ref={feedbackRef}
                outcome={outcome}
                celebrate
                type={current.type}
                onOpenSource={onOpenSource}
                onAsk={onAskQuestion ? () => onAskQuestion(current.questionId) : undefined}
              />
            </div>
          )}
        </div>
        {paused && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Paused"
            className="anim-fade absolute inset-0 grid place-items-center bg-bg p-6"
          >
            <div className="max-w-sm space-y-4 rounded-panel border border-border bg-surface p-8 text-center shadow-card">
              <h2 className="font-display text-heading font-semibold">Paused</h2>
              <p className="text-text-muted">Your place is saved and the timer is stopped.</p>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                data-testid="resume"
                autoFocus
                onClick={() => setPaused(false)}
              >
                Resume
              </Button>
            </div>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-border bg-bg px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-6">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
          {phase === "answering" ? (
            <>
              {session.onlySkippedLeft ? (
                <Button variant="ghost" className={QUIET} onClick={() => setFinishOpen(true)}>
                  Finish
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className={QUIET}
                  data-testid="skip"
                  disabled={busy}
                  onClick={() => void skip()}
                >
                  Skip
                </Button>
              )}
              {!selfSubmitting && (
                <Button
                  variant="primary"
                  size="lg"
                  className="ml-auto min-w-40 flex-1 sm:flex-none"
                  data-testid="submit"
                  disabled={!ready || busy}
                  onClick={() => void submit()}
                >
                  {current.type === "case" ? "Check answers" : "Check answer"}
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="ml-auto w-full sm:w-auto sm:min-w-48"
              data-testid="next"
              disabled={busy || phase === "finishing"}
              onClick={() => void next()}
            >
              {moreAfter ? "Next question" : "See results"}
            </Button>
          )}
        </div>
      </footer>

      <LiveRegion message={message} testId="announcer" />
      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Leave this session?"
        description="Your answers so far are saved. You can pick up where you left off from the start screen."
        confirmLabel="Leave"
        cancelLabel="Keep going"
        onConfirm={() => {
          setLeaveOpen(false);
          leave();
        }}
      />
      <ConfirmDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title="Finish now?"
        description="Questions you have not answered will be left out of the results."
        confirmLabel="Finish and see results"
        cancelLabel="Keep going"
        onConfirm={() => {
          setFinishOpen(false);
          void finish();
        }}
      />
    </Shell>
  );
}

function Shell({
  rootRef,
  children,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  // Rendered on the body, not where the screen is mounted: on a phone the app shell wraps each page in
  // an element with a view-transition-name, which holds `fixed` children inside it and under the tab
  // bar, so "Check answer" sat behind the tab bar and could not be tapped.
  return createPortal(
    <div
      ref={rootRef}
      className="pr-root fixed inset-x-0 z-(--z-dock) flex flex-col bg-bg"
      style={{ top: "var(--pr-vt, 0px)", height: "var(--pr-vh, 100dvh)" }}
      data-testid="player-shell"
    >
      {children}
    </div>,
    document.body,
  );
}

function messageOf(e: unknown): string {
  if (e instanceof PracticeApiError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}
