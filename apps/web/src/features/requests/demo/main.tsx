/**
 * Standalone demo page for development, Playwright and screenshots. Not part of the app build.
 * Query: ?theme=light|dark  ?view=requests|asks (the Ask buttons of other screens)
 *        ?slow=800 (delay every call)  ?fail=1 (every call fails)  ?empty=1 (no requests)
 *        ?fresh=1 (forget which answers she has seen)  ?bar=0 (hide the demo bar)
 */
import type { RequestTarget } from "@notes/schema";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../app/styles.css";
import { AskButton } from "../AskButton";
import { RequestsBadge } from "../RequestsBadge";
import { RequestsView } from "../RequestsView";
import { createMockRequestsStore } from "../store/mock";
import { bid, did, fid, nid, pgid, qid } from "../store/seed";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
if (params.get("fresh") === "1") {
  try {
    if (!sessionStorage.getItem("requests-fresh-done")) {
      localStorage.removeItem("notes-requests-seen");
      sessionStorage.setItem("requests-fresh-done", "1");
    }
  } catch {
    // storage unavailable: nothing to forget
  }
}

const store = createMockRequestsStore({
  delayMs: Number(params.get("slow") ?? 0) || undefined,
  failWith: params.get("fail") === "1" ? "The demo server is pretending to be down." : undefined,
  empty: params.get("empty") === "1",
});

interface Opened {
  kind: string;
  detail: unknown;
}
declare global {
  interface Window {
    __requests: { store: typeof store; opened: Opened[] };
  }
}
window.__requests = { store, opened: [] };

const ASKS: Array<{ label: string; target: RequestTarget; title: string }> = [
  { label: "Your library", target: { type: "library" }, title: "The whole library" },
  { label: "Beta blockers", target: { type: "node", nodeId: nid(1) }, title: "A lecture" },
  {
    label: "Beta blockers: study guide",
    target: { type: "document", documentId: did(1) },
    title: "A document",
  },
  {
    label: "Atenolol card",
    target: { type: "block", documentId: did(1), blockId: bid(1) },
    title: "A block",
  },
  {
    label: "Slide 12",
    target: { type: "source", fileId: fid(1), pageId: pgid(12) },
    title: "A source page",
  },
  { label: "Question 14", target: { type: "question", questionId: qid(1) }, title: "A question" },
];

function Demo() {
  const [mode, setMode] = useState<string>(document.documentElement.dataset.theme ?? "system");
  const [note, setNote] = useState<string | null>(null);
  const view = params.get("view") === "asks" ? "asks" : "requests";
  useEffect(() => {
    if (mode === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
  }, [mode]);

  const opened = (kind: string, detail: unknown, text: string) => {
    window.__requests.opened.push({ kind, detail });
    setNote(text);
  };

  return (
    <div className="min-h-dvh bg-bg text-text">
      {params.get("bar") !== "0" && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-text-muted"
          data-demo-bar
        >
          <span className="flex items-center gap-2">
            Requests demo (mock data) <RequestsBadge store={store} />
          </span>
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
      {view === "asks" ? (
        <div className="mx-auto max-w-2xl px-4 py-6">
          <h1 className="font-display text-2xl font-semibold">Ask buttons</h1>
          <ul className="mt-4 grid gap-2">
            {ASKS.map((ask) => (
              <li
                key={ask.title}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-2"
              >
                <span>
                  <span className="block text-sm font-medium">{ask.label}</span>
                  <span className="block text-xs text-text-muted">{ask.title}</span>
                </span>
                <AskButton target={ask.target} targetLabel={ask.label} submit={store.create} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <RequestsView
          store={store}
          openSource={(t) => opened("source", t, `Would open the source page ${t.pageId ?? ""}`)}
          openNode={(id) => opened("node", id, `Would open library item ${id}`)}
          onOpenDocument={(t) => opened("document", t, `Would open the document ${t.documentId}`)}
          onOpenQuestion={(t) => opened("question", t, `Would open question ${t.questionId}`)}
          onOpenConcept={(id) => opened("concept", id, `Would open concept ${id}`)}
        />
      )}
      {note ? (
        <div
          role="status"
          data-testid="opened"
          className="fixed inset-x-4 bottom-4 z-[80] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-sm shadow-pop"
        >
          <span>{note}</span>
          <button
            type="button"
            className="min-h-11 px-2 font-medium text-accent"
            onClick={() => setNote(null)}
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
