import { useCallback, useEffect, useRef, useState } from "react";
import { ExamPlanner, UpcomingExamsCard } from "../exams";
import type { PickNodes } from "../exams/types";
import "./practice.css";
import { Cards } from "./screens/Cards";
import { Notebook } from "./screens/Notebook";
import { Player } from "./screens/Player";
import { Results } from "./screens/Results";
import { Start } from "./screens/Start";
import { WeakAreas } from "./screens/WeakAreas";
import type { PracticeStore, SessionResults, SessionScope, SourceCitation } from "./types";
import { ErrorNote } from "./ui/primitives";

export type PracticeView = "start" | "cards" | "notebook" | "weak" | "exams";

const NAV: { view: PracticeView; label: string }[] = [
  { view: "start", label: "Practice" },
  { view: "cards", label: "Cards" },
  { view: "notebook", label: "Notebook" },
  { view: "weak", label: "Weak areas" },
  { view: "exams", label: "Exams" },
];

export interface PracticeAppProps {
  /** Where data comes from. The shell injects the HTTP store; the demo injects the mock. */
  store: PracticeStore;
  /** The lecture or folder she is looking at, offered first on the start screen. */
  currentNodeId?: string | null;
  /** The shell's lecture/folder picker, used by the exam planner. */
  pickNodes: PickNodes;
  /** Open a cited source page (called with the citation from a result). */
  onOpenSource?: (citation: SourceCitation) => void;
  /** Ask an agent about the question on screen (the shell opens its request composer). */
  onAskQuestion?: ((questionId: string) => void) | undefined;
  /** Controlled view; omit to let the module keep it. */
  view?: PracticeView;
  onViewChange?: (view: PracticeView) => void;
  /** True while a session is on screen, so the shell can guard its own navigation. */
  onActiveChange?: (active: boolean) => void;
  /** Open straight into this session (a link to /practice/session/:id). */
  initialSessionId?: string | undefined;
  /** Start a session on this scope at once ("Practise this"). */
  autoStart?: SessionScope | undefined;
  className?: string;
}

type Mode =
  | { kind: "browse" }
  | { kind: "play"; sessionId: string }
  | { kind: "results"; results: SessionResults };

/**
 * The whole practice experience: start screen, session player, results, flashcards, notebook,
 * weak areas and the exam planner. Mount it in the main area; the player takes the full screen.
 */
export function PracticeApp({
  store,
  currentNodeId,
  pickNodes,
  onOpenSource,
  onAskQuestion,
  view: controlledView,
  onViewChange,
  onActiveChange,
  initialSessionId,
  autoStart,
  className = "",
}: PracticeAppProps) {
  const [ownView, setOwnView] = useState<PracticeView>("start");
  const view = controlledView ?? ownView;
  const setView = useCallback(
    (v: PracticeView) => {
      setOwnView(v);
      onViewChange?.(v);
    },
    [onViewChange],
  );
  const [mode, setMode] = useState<Mode>(() =>
    initialSessionId ? { kind: "play", sessionId: initialSessionId } : { kind: "browse" },
  );
  const [refresh, setRefresh] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const bump = () => setRefresh((n) => n + 1);

  const play = (sessionId: string) => {
    setProblem(null);
    setMode({ kind: "play", sessionId });
  };
  const startScope = async (
    scope: SessionScope,
    length = 10,
    formats?: Parameters<PracticeStore["startSession"]>[0]["formats"],
  ) => {
    try {
      const s = await store.startSession({
        scope,
        formats: formats ?? [
          "multiple_choice",
          "select_all",
          "matching",
          "fill_blank",
          "calculation",
          "case",
          "free_response",
        ],
        length,
      });
      if (s.total === 0) {
        setProblem("There is nothing to practise there yet.");
        setMode({ kind: "browse" });
        return;
      }
      play(s.id);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not start a session.");
    }
  };

  const autoStarted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: start once, when asked to
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void startScope(autoStart);
  }, [autoStart]);

  if (mode.kind === "play") {
    return (
      <Player
        key={mode.sessionId}
        store={store}
        sessionId={mode.sessionId}
        onOpenSource={onOpenSource}
        onAskQuestion={onAskQuestion}
        onActiveChange={onActiveChange}
        onExit={() => {
          bump();
          setMode({ kind: "browse" });
        }}
        onFinished={(results) => {
          bump();
          setMode({ kind: "results", results });
        }}
      />
    );
  }

  const results = mode.kind === "results" ? mode.results : null;

  return (
    <div
      className={`pr-root mx-auto w-full max-w-5xl px-4 pb-16 pt-5 md:px-8 md:pt-8 ${className}`}
      data-testid="practice-app"
    >
      {!results && (
        <nav
          aria-label="Practice sections"
          className="-mx-4 mb-7 overflow-x-auto px-4 md:mx-0 md:px-0"
        >
          <ul className="grid grid-cols-5 gap-0.5 rounded-full border border-border bg-surface-muted p-1 sm:inline-flex sm:gap-1">
            {NAV.map((n) => (
              <li key={n.view}>
                <button
                  type="button"
                  aria-current={view === n.view ? "page" : undefined}
                  data-testid={`nav-${n.view}`}
                  onClick={() => {
                    setProblem(null);
                    setView(n.view);
                  }}
                  className="min-h-11 whitespace-nowrap w-full rounded-full px-1 text-[0.8rem] sm:px-4 sm:text-sm font-medium text-text-muted transition-colors hover:text-text aria-[current=page]:bg-surface aria-[current=page]:text-text aria-[current=page]:shadow-sm"
                >
                  {n.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {problem && (
        <div className="mb-5">
          <ErrorNote message={problem} />
        </div>
      )}
      {results ? (
        <Results
          store={store}
          results={results}
          onOpenSource={onOpenSource}
          onDone={() => setMode({ kind: "browse" })}
          onOpenNotebook={() => {
            setView("notebook");
            setMode({ kind: "browse" });
          }}
          onRetryMissed={() => void startScope({ kind: "missed" }, 20)}
          onPracticeScope={(scope) => void startScope(scope)}
        />
      ) : view === "start" ? (
        <div className="space-y-8">
          <Start
            store={store}
            currentNodeId={currentNodeId}
            refreshKey={refresh}
            onStarted={(s) => play(s.id)}
            onResume={play}
            onOpenView={setView}
          />
          <UpcomingExamsCard
            api={store}
            refreshKey={refresh}
            onOpenPlanner={() => setView("exams")}
            onPractice={(examId) => void startScope({ kind: "exam", examId }, 10)}
          />
        </div>
      ) : view === "cards" ? (
        <Cards store={store} refreshKey={refresh} onStarted={(s) => play(s.id)} />
      ) : view === "notebook" ? (
        <Notebook store={store} refreshKey={refresh} onStarted={(s) => play(s.id)} />
      ) : view === "weak" ? (
        <WeakAreas store={store} refreshKey={refresh} onStarted={(s) => play(s.id)} />
      ) : (
        <ExamPlanner
          api={store}
          pickNodes={pickNodes}
          refreshKey={refresh}
          onPractice={(examId) => void startScope({ kind: "exam", examId }, 10)}
        />
      )}
    </div>
  );
}
