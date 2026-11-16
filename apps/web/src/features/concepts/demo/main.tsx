/**
 * Standalone demo page for development, Playwright and screenshots. Not part of the app build.
 * Query: ?theme=light|dark  ?concept=metoprolol (open a page by key)  ?tab=browse|find|compare|drill
 *        ?seed=3 (fixed drill shuffle)  ?slow=800 (delay every call)  ?fail=1 (every call fails)
 *        ?empty=1 (no concepts)  ?bar=0 (hide the demo bar)
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../app/styles.css";
import { ConceptsIndex } from "../ConceptsIndex";
import { ConceptView } from "../ConceptView";
import { seededRng } from "../model/drill";
import { createMockConceptsStore } from "../store/mock";
import { KEY } from "../store/seed";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

const store = createMockConceptsStore({
  delayMs: Number(params.get("slow") ?? 0) || undefined,
  failWith: params.get("fail") === "1" ? "The demo server is pretending to be down." : undefined,
  empty: params.get("empty") === "1",
});

interface Opened {
  kind: "source" | "node" | "document" | "question" | "concept";
  detail: unknown;
}
declare global {
  interface Window {
    __concepts: {
      store: typeof store;
      opened: Opened[];
      keys: Record<string, string>;
    };
  }
}
window.__concepts = { store, opened: [], keys: KEY };

type View = { kind: "index" } | { kind: "concept"; id: string };
const startKey = params.get("concept");
const start: View = startKey
  ? { kind: "concept", id: KEY[startKey] ?? startKey }
  : { kind: "index" };
const seed = params.get("seed");

function Demo() {
  const [view, setView] = useState<View>(start);
  const [toast, setToast] = useState<string | null>(null);
  const [mode, setMode] = useState<string>(document.documentElement.dataset.theme ?? "system");
  useEffect(() => {
    if (mode === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
  }, [mode]);

  const note = (kind: Opened["kind"], detail: unknown, text: string) => {
    window.__concepts.opened.push({ kind, detail });
    setToast(text);
  };
  const props = {
    store,
    search: new URLSearchParams(window.location.search),
    SourceViewer: undefined,
    openSource: (t: { fileId: string; pageId?: string; quote?: string }) =>
      note("source", t, `Would open the source: “${t.quote ?? ""}”`),
    openNode: (id: string) => note("node", id, `Would open library item ${id}`),
    onOpenConcept: (id: string) => {
      window.__concepts.opened.push({ kind: "concept", detail: id });
      setView({ kind: "concept", id });
      window.scrollTo(0, 0);
    },
    onOpenIndex: () => setView({ kind: "index" }),
    onOpenDocument: (t: { nodeId: string; blockId?: string | null }) =>
      note("document", t, `Would open the document, block ${t.blockId ?? "none"}`),
    onOpenQuestion: (t: { questionId: string }) =>
      note("question", t, `Would open practice question ${t.questionId}`),
  };

  return (
    <div className="min-h-dvh bg-bg text-text">
      {params.get("bar") !== "0" && (
        <div
          className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-text-muted"
          data-demo-bar
        >
          <span>Concepts demo (mock data)</span>
          <span className="flex gap-1">
            {["light", "dark", "system"].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={mode === t}
                onClick={() => setMode(t)}
                className="min-h-8 rounded-full px-3 aria-pressed:bg-accent aria-pressed:text-accent-contrast"
              >
                {t}
              </button>
            ))}
          </span>
        </div>
      )}
      {view.kind === "index" ? (
        <ConceptsIndex
          {...props}
          params={{}}
          drillRng={seed ? seededRng(Number(seed)) : undefined}
        />
      ) : (
        <ConceptView key={view.id} {...props} params={{ id: view.id }} />
      )}
      {toast ? (
        <div
          role="status"
          data-testid="source-opened"
          className="fixed inset-x-4 bottom-4 z-[80] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-sm shadow-pop"
        >
          <span>{toast}</span>
          <button
            type="button"
            className="min-h-11 rounded-xl px-3 font-medium text-accent"
            onClick={() => setToast(null)}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
