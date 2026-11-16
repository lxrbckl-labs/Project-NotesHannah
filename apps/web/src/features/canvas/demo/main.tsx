import { type Block, blockPlainText, stampNewBlock, validateBlockInput } from "@notes/schema";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../app/styles.css";
import { CanvasView } from "../CanvasView";
import { makeFixture } from "../layout/fixtures";
import { MemoryCanvasStore, type MemoryDocument } from "../store/memory-store";
import { buildSeed, DEMO_DOCUMENT_ID, DEMO_USER } from "../store/seed";
import { Icon } from "../ui/icons";

/**
 * Standalone demo of the canvas on the in-memory store, served by Vite at
 * /canvas-demo.html. Query parameters:
 *   ?cards=300   a synthetic canvas of that many cards (performance runs)
 *   ?culling=1   React Flow's only-render-visible mode
 *   ?reset=1     forget what was saved in this browser
 */

const params = new URLSearchParams(location.search);
const PERSIST = "notes-canvas-demo";

if (params.has("reset")) {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(PERSIST)) localStorage.removeItem(key);
  } catch {
    // storage blocked
  }
}

function syntheticDocument(count: number): MemoryDocument {
  const fixture = makeFixture(count, { pinned: Math.floor(count / 30) });
  const blocks: Block[] = fixture.blocks.map((raw) => {
    const valid = validateBlockInput({ type: raw.type, content: raw.content }, { writer: "user" });
    if (!valid.ok) throw new Error(JSON.stringify(valid.problems));
    return stampNewBlock(valid.block, {
      actor: DEMO_USER,
      id: raw.id,
      now: "2026-11-15T18:00:00.000Z",
    });
  });
  return {
    id: fixture.canvas.documentId,
    title: `Synthetic map · ${count} cards`,
    blocks,
    canvas: fixture.canvas,
  };
}

const cards = Number(params.get("cards") ?? 0);
const document_ = cards > 0 ? syntheticDocument(cards) : buildSeed().document;
const store = new MemoryCanvasStore({
  actor: DEMO_USER,
  documents: [document_],
  persistKey: cards > 0 ? undefined : PERSIST,
  debounceMs: 250,
});
(window as unknown as { __canvasDemo: unknown }).__canvasDemo = { store, documentId: document_.id };

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches,
  );
  return (
    <button
      type="button"
      className="nc-btn"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title="Theme"
      data-testid="theme-toggle"
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("notes-theme", next);
        } catch {
          // storage blocked
        }
        setDark(!dark);
      }}
    >
      <Icon name={dark ? "sun" : "moon"} />
    </button>
  );
}

function Demo() {
  const [opened, setOpened] = useState<string | null>(null);
  const [page, setPage] = useState(false);
  const blocks = useMemo(() => new Map(document_.blocks.map((b) => [b.id, b])), []);
  const block = opened ? blocks.get(opened) : undefined;
  if (page)
    return (
      <main style={{ padding: 24 }} data-testid="page-view">
        <h1>{document_.title}</h1>
        <p>The page view lives in the documents feature.</p>
        <button type="button" className="nc-btn" onClick={() => setPage(false)}>
          Back to canvas
        </button>
      </main>
    );
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <CanvasView
        store={store}
        documentId={document_.id ?? DEMO_DOCUMENT_ID}
        onOpenBlock={setOpened}
        onOpenConcept={(id) => setOpened(id)}
        onSwitchToPage={() => setPage(true)}
        topBarExtras={<ThemeToggle />}
        onlyRenderVisible={params.get("culling") === "1"}
      />
      {opened && (
        <div
          role="dialog"
          aria-label="Opened block"
          data-testid="opened-block"
          data-block-id={opened}
          style={{
            position: "fixed",
            left: "50%",
            bottom: 96,
            transform: "translateX(-50%)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            padding: "12px 16px",
            maxWidth: "min(520px, calc(100vw - 32px))",
            boxShadow: "0 8px 30px rgb(0 0 0 / 0.18)",
            zIndex: 100,
          }}
        >
          <strong>Would open in the page view</strong>
          <p style={{ margin: "6px 0 10px", color: "var(--color-text-muted)" }}>
            {block ? blockPlainText(block).slice(0, 160) : opened}
          </p>
          <button type="button" onClick={() => setOpened(null)} style={{ minHeight: 44 }}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
